import { IpcChannels } from '@shared/constants/ipc-channels'
import { APP_VERSION } from '@shared/constants/app'
import type { ModeConfig, AppRuntimeInfo } from '@shared/types/mode'
import type { ClientConnectionStatus, DashboardStats, ServerStatus } from '@shared/types/dashboard'
import type { Judoka, DuplicateMatch } from '@shared/types/judoka'
import type { BadgeTemplate } from '@shared/types/badge'
import type { AppSettings } from '@shared/types/settings'
import type { UserAccount } from '@shared/types/user-account'
import { createDefaultBadgeTemplate } from '@shared/types/badge'
import { createDefaultSettings } from '@shared/types/settings'
import { computeAge } from '@shared/utils/judoka'
import { formatCreatorLabel } from '@shared/utils/creator'
import { judokaFormSchema } from '@shared/validation/judoka'
import { supabase, type JudokaRow, type ProfileRow } from './supabase'
import {
  rowToJudoka,
  judokaToRow,
  profileToUserAccount,
  mergeSettings,
  templateFromRow,
  logRowToEntry
} from './mappers'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; details?: unknown }

export interface PrinterInfoLite {
  name: string
  displayName: string
  description: string
  isDefault: boolean
  status: number
}

const PHOTOS_BUCKET = 'photos'
const BADGE_ASSETS_BUCKET = 'badge-assets'

let cachedProfile: ProfileRow | null = null
let cachedMode: ModeConfig | null = null
let cachedAccessToken: string | null = null
let pendingBackupJson: Record<string, unknown> | null = null

async function getProfile(): Promise<ProfileRow | null> {
  if (cachedProfile) return cachedProfile
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  cachedProfile = data as ProfileRow | null
  return cachedProfile
}

export function clearProfileCache(): void {
  cachedProfile = null
  cachedAccessToken = null
}

export function syncAccessToken(token: string | null): void {
  cachedAccessToken = token
}

async function getAccessToken(): Promise<string | null> {
  if (cachedAccessToken) return cachedAccessToken

  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    cachedAccessToken = session.access_token
    return cachedAccessToken
  }

  const { data: { session: refreshed } } = await supabase.auth.refreshSession()
  if (refreshed?.access_token) {
    cachedAccessToken = refreshed.access_token
    return cachedAccessToken
  }

  return null
}

async function requireProfile(): Promise<ProfileRow> {
  const p = await getProfile()
  if (!p?.active) throw new Error('Session invalide ou compte désactivé')
  return p
}

async function logSystem(
  level: 'info' | 'warn' | 'error',
  action: string,
  message: string,
  actor?: string,
  workstation?: string
): Promise<void> {
  await supabase.from('system_logs').insert({
    level,
    action,
    message,
    actor,
    workstation
  })
}

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function fail(error: string, code?: string, details?: unknown): IpcResult<never> {
  return { ok: false, error, code, details }
}

async function nextDisplayId(): Promise<string> {
  const { data, error } = await supabase.rpc('next_display_id')
  if (error || !data) throw new Error(error?.message ?? 'Impossible de générer le numéro de badge')
  return data as string
}

async function findDuplicates(candidate: {
  lastName: string
  firstName: string
  birthDate: string
  licenseNumber?: string
  excludeId?: string
}): Promise<DuplicateMatch[]> {
  const { data } = await supabase.from('judokas').select('*')
  const items = (data ?? []).map((r) => rowToJudoka(r as never))
  const matches: DuplicateMatch[] = []
  for (const j of items) {
    if (candidate.excludeId && j.id === candidate.excludeId) continue
    const matchedOn: DuplicateMatch['matchedOn'] = []
    const sameName =
      j.lastName.toLowerCase() === candidate.lastName.trim().toLowerCase() &&
      j.firstName.toLowerCase() === candidate.firstName.trim().toLowerCase()
    if (sameName) matchedOn.push('name')
    if (j.birthDate === candidate.birthDate) matchedOn.push('birthDate')
    if (
      candidate.licenseNumber?.trim() &&
      j.licenseNumber === candidate.licenseNumber.trim()
    ) {
      matchedOn.push('licenseNumber')
    }
    if (
      (sameName && j.birthDate === candidate.birthDate) ||
      (candidate.licenseNumber?.trim() && j.licenseNumber === candidate.licenseNumber.trim())
    ) {
      matches.push({ judoka: j, matchedOn })
    }
  }
  return matches
}

async function getActiveTemplateId(): Promise<string> {
  const { data } = await supabase.from('badge_template_meta').select('active_template_id').eq('id', 'default').single()
  return data?.active_template_id ?? 'default'
}

async function ensureDefaultTemplate(): Promise<BadgeTemplate> {
  const { data: existing } = await supabase.from('badge_templates').select('*').eq('id', 'default').maybeSingle()
  if (existing) return templateFromRow(existing as never)
  const template = createDefaultBadgeTemplate()
  await supabase.from('badge_templates').insert({
    id: 'default',
    name: template.name,
    is_default: true,
    template
  })
  return template
}

async function uploadDataUrl(bucket: string, dataUrl: string, prefix: string): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new Error('Session expirée — reconnectez-vous.')

  const compressed = await compressImageDataUrl(dataUrl)
  // Estimation taille base64
  const approxBytes = Math.ceil(((compressed.split(',')[1]?.length ?? 0) * 3) / 4)
  assertPhotoSize(approxBytes)

  const res = await fetch('/api/photos/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ dataUrl: compressed, bucket, prefix })
  })
  const text = await res.text()
  let json: { ok?: boolean; data?: { path: string }; error?: string } = {}
  try {
    json = text ? (JSON.parse(text) as typeof json) : {}
  } catch {
    throw new Error(
      res.ok
        ? 'Réponse upload invalide'
        : `Upload photo échoué (${res.status}). Vérifiez SUPABASE_SERVICE_ROLE_KEY sur Vercel.`
    )
  }
  if (!res.ok || !json.ok || !json.data?.path) {
    throw new Error(json.error ?? 'Upload photo échoué')
  }
  return json.data.path
}

async function readStorageDataUrl(bucket: string, path: string): Promise<string> {
  if (path.startsWith('data:')) return path
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error || !data) throw new Error(error?.message ?? 'Photo introuvable')
  const buf = await data.arrayBuffer()
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
  const ext = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  return `data:${ext};base64,${b64}`
}

async function readAnyStorageDataUrl(path: string): Promise<string> {
  if (path.startsWith('data:') || path.startsWith('http')) {
    if (path.startsWith('data:')) return path
    const res = await fetch(path)
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = reject
      r.readAsDataURL(blob)
    })
  }
  const buckets =
    path.startsWith('background/') || path.startsWith('logo/')
      ? [BADGE_ASSETS_BUCKET, PHOTOS_BUCKET]
      : [PHOTOS_BUCKET, BADGE_ASSETS_BUCKET]
  let lastError: Error | null = null
  for (const bucket of buckets) {
    try {
      return await readStorageDataUrl(bucket, path)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw lastError ?? new Error('Fichier introuvable')
}

/** Compresse / redimensionne une image data URL pour un upload rapide (max 1280px, JPEG ~0.82). */
async function compressImageDataUrl(dataUrl: string, maxSide = 1280, quality = 0.82): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = dataUrl
  })
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024

function assertPhotoSize(fileOrBytes: number): void {
  if (fileOrBytes > MAX_PHOTO_BYTES) {
    throw new Error('La photo ne doit pas dépasser 10 Mo.')
  }
}

async function getSessionToken(): Promise<string | null> {
  return getAccessToken()
}

async function fetchOnlineClients(): Promise<
  import('@shared/types/dashboard').ConnectedClient[]
> {
  try {
    const token = await getAccessToken()
    if (!token) return []
    const res = await fetch('/api/presence', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      data?: { items?: import('@shared/types/dashboard').ConnectedClient[] }
    }
    if (!res.ok || !json.ok) return []
    return json.data?.items ?? []
  } catch {
    return []
  }
}

export const judovacClient = {
  invoke: <T = unknown>(_channel: string, ..._args: unknown[]) =>
    Promise.resolve({ ok: false, error: 'Non supporté en mode web' } as T),

  getAppInfo: async (): Promise<IpcResult<AppRuntimeInfo>> => {
    const profile = await getProfile()
    return ok({
      version: APP_VERSION,
      platform: 'web',
      mode: cachedMode?.mode ?? null,
      userDataPath: profile?.username ?? ''
    })
  },

  getMode: async (): Promise<IpcResult<ModeConfig | null>> => ok(cachedMode),

  setMode: async (config: ModeConfig): Promise<IpcResult<ModeConfig>> => {
    cachedMode = config
    return ok(config)
  },

  clearMode: async (): Promise<IpcResult<boolean>> => {
    cachedMode = null
    return ok(true)
  },

  getServerStatus: async (): Promise<IpcResult<ServerStatus>> => {
    const profile = await requireProfile()
    const connectedClients = profile.role === 'admin' ? await fetchOnlineClients() : []

    if (profile.role !== 'admin') {
      return ok({
        running: false,
        host: 'cloud',
        port: 443,
        startedAt: null,
        connectedClients: [],
        dbReady: true,
        dbBackend: 'cloud',
        localAddresses: [],
        preferredAddress: null
      })
    }
    return ok({
      running: true,
      host: 'cloud',
      port: 443,
      startedAt: new Date().toISOString(),
      connectedClients,
      dbReady: true,
      dbBackend: 'cloud',
      localAddresses: [],
      preferredAddress: window.location.hostname
    })
  },

  /** Ping de présence (opérateur connecté). */
  heartbeat: async (): Promise<IpcResult<boolean>> => {
    try {
      const token = await getAccessToken()
      if (!token) return fail('Session expirée')
      const res = await fetch('/api/presence', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) return fail(json.error ?? 'Présence échouée')
      return ok(true)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  getClientStatus: async (): Promise<IpcResult<ClientConnectionStatus>> => {
    const { data: { session } } = await supabase.auth.getSession()
    return ok({
      connected: !!session,
      serverHost: window.location.hostname,
      serverPort: 443,
      lastError: null,
      queueSize: 0,
      lastSyncAt: new Date().toISOString()
    })
  },

  getDashboardStats: async (): Promise<IpcResult<DashboardStats>> => {
    const profile = await requireProfile()
    if (profile.role === 'operator') {
      void judovacClient.heartbeat()
    }

    const { data: judokas } = await supabase.from('judokas').select('created_by')
    const all = judokas ?? []
    const map = new Map<string, number>()
    for (const j of all) {
      const label = formatCreatorLabel(j.created_by as string)
      map.set(label, (map.get(label) ?? 0) + 1)
    }
    if (!map.has('Serveur')) map.set('Serveur', 0)
    const judokaByUser = [...map.entries()]
      .map(([username, count]) => ({ username, count }))
      .sort((a, b) => {
        if (a.username === 'Serveur') return -1
        if (b.username === 'Serveur') return 1
        return a.username.localeCompare(b.username, 'fr')
      })

    const { data: logs } = await supabase
      .from('system_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)

    const online = profile.role === 'admin' ? await fetchOnlineClients() : []

    return ok({
      totalJudokas: all.length,
      connectedClients: online.length,
      networkStatus: 'online',
      pendingSyncCount: 0,
      lastSyncAt: new Date().toISOString(),
      recentLogs: (logs ?? []).map((l) => logRowToEntry(l as never)),
      userActivity: [],
      judokaByUser
    })
  },

  createJudoka: async (body: unknown): Promise<IpcResult<unknown>> => {
    try {
      const profile = await requireProfile()
      const parsed = judokaFormSchema.safeParse({
        ...(body as object),
        createdBy: (body as { createdBy?: string }).createdBy ?? profile.username,
        createdWorkstation: (body as { createdWorkstation?: string }).createdWorkstation ?? 'web'
      })
      if (!parsed.success) {
        return fail('Données judoka invalides', 'VALIDATION', parsed.error.flatten())
      }

      const force = Boolean((body as { force?: boolean })?.force)
      const duplicates = await findDuplicates({
        lastName: parsed.data.lastName,
        firstName: parsed.data.firstName,
        birthDate: parsed.data.birthDate,
        licenseNumber: parsed.data.licenseNumber
      })
      if (duplicates.length > 0 && !force) {
        return fail('Doublon potentiel détecté', 'DUPLICATE', { duplicates })
      }

      const displayId = await nextDisplayId()
      const now = new Date().toISOString()
      const row = judokaToRow({
        id: crypto.randomUUID(),
        displayId,
        ...parsed.data,
        age: computeAge(parsed.data.birthDate),
        createdAt: now,
        updatedAt: now,
        syncStatus: 'synced',
        version: 1
      })

      const { data, error } = await supabase.from('judokas').insert(row).select('*').single()
      if (error) return fail(error.message)

      const judoka = rowToJudoka(data as never)
      await logSystem('info', 'judoka.create', `Judoka créé ${judoka.displayId}`, judoka.createdBy, judoka.createdWorkstation)
      return ok({ judoka })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  getJudoka: async (id: string): Promise<IpcResult<Judoka>> => {
    const { data, error } = await supabase.from('judokas').select('*').eq('id', id).single()
    if (error || !data) return fail(error?.message ?? 'Judoka introuvable')
    return ok(rowToJudoka(data as never))
  },

  updateJudoka: async (id: string, body: unknown): Promise<IpcResult<unknown>> => {
    try {
      const { data: existing, error: fetchErr } = await supabase.from('judokas').select('*').eq('id', id).single()
      if (fetchErr || !existing) return fail('Judoka introuvable')

      const patch = body as Partial<Judoka>
      const birthDate = patch.birthDate ?? (existing as JudokaRow).birth_date
      const update = {
        last_name: patch.lastName ?? (existing as JudokaRow).last_name,
        middle_name: patch.middleName ?? (existing as JudokaRow).middle_name,
        first_name: patch.firstName ?? (existing as JudokaRow).first_name,
        sex: patch.sex ?? (existing as JudokaRow).sex,
        birth_date: birthDate,
        age: computeAge(birthDate),
        province: patch.province ?? (existing as JudokaRow).province,
        city: patch.city ?? (existing as JudokaRow).city,
        commune: patch.commune ?? (existing as JudokaRow).commune,
        address: patch.address ?? (existing as JudokaRow).address,
        phone: patch.phone ?? (existing as JudokaRow).phone,
        email: patch.email ?? (existing as JudokaRow).email,
        club: patch.club ?? (existing as JudokaRow).club,
        league: patch.league ?? (existing as JudokaRow).league,
        sport_province: patch.sportProvince ?? (existing as JudokaRow).sport_province,
        grade: patch.grade ?? (existing as JudokaRow).grade,
        belt: patch.belt ?? (existing as JudokaRow).belt,
        category: patch.category ?? (existing as JudokaRow).category,
        weight_kg: patch.weightKg !== undefined ? patch.weightKg : (existing as JudokaRow).weight_kg,
        height_cm: patch.heightCm !== undefined ? patch.heightCm : (existing as JudokaRow).height_cm,
        license_number: patch.licenseNumber ?? (existing as JudokaRow).license_number,
        affiliation_year: patch.affiliationYear !== undefined ? patch.affiliationYear : (existing as JudokaRow).affiliation_year,
        photo_path: patch.photoPath !== undefined ? patch.photoPath : (existing as JudokaRow).photo_path,
        version: (existing as JudokaRow).version + 1
      }

      const { data, error } = await supabase.from('judokas').update(update).eq('id', id).select('*').single()
      if (error) return fail(error.message)
      return ok({ judoka: rowToJudoka(data as never) })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  deleteJudoka: async (id: string): Promise<IpcResult<boolean>> => {
    const { error } = await supabase.from('judokas').delete().eq('id', id)
    if (error) return fail(error.message)
    return ok(true)
  },

  listJudokas: async (opts?: { limit?: number; offset?: number }): Promise<
    IpcResult<{ items: Judoka[]; total: number }>
  > => {
    const profile = await requireProfile()
    const limit = opts?.limit ?? 100
    const offset = opts?.offset ?? 0
    let q = supabase
      .from('judokas')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (profile.role !== 'admin') {
      q = q.eq('created_by', profile.username)
    }
    const { data, count, error } = await q
    if (error) return fail(error.message)
    return ok({ items: (data ?? []).map((r) => rowToJudoka(r as never)), total: count ?? 0 })
  },

  searchJudokas: async (
    query: string,
    filters?: Record<string, string>
  ): Promise<IpcResult<{ items: Judoka[] }>> => {
    const profile = await requireProfile()
    let q = supabase.from('judokas').select('*').order('created_at', { ascending: false }).limit(5000)
    if (profile.role !== 'admin') {
      q = q.eq('created_by', profile.username)
    }
    const { data, error } = await q
    if (error) return fail(error.message)

    const ql = query.trim().toLowerCase()
    const items = (data ?? [])
      .map((r) => rowToJudoka(r as never))
      .filter((j) => {
        if (filters?.club && !j.club.toLowerCase().includes(filters.club.toLowerCase())) return false
        if (filters?.province && !j.province.toLowerCase().includes(filters.province.toLowerCase())) return false
        if (filters?.league && !j.league.toLowerCase().includes(filters.league.toLowerCase())) return false
        if (filters?.grade && !j.grade.toLowerCase().includes(filters.grade.toLowerCase())) return false
        if (filters?.phone && !j.phone.includes(filters.phone)) return false
        if (filters?.licenseNumber && !j.licenseNumber.includes(filters.licenseNumber)) return false
        if (filters?.createdBy && formatCreatorLabel(j.createdBy) !== filters.createdBy) return false
        if (!ql) return true
        const hay = [j.lastName, j.middleName, j.firstName, j.displayId, j.licenseNumber, j.phone, j.club]
          .join(' ')
          .toLowerCase()
        return hay.includes(ql)
      })
    return ok({ items })
  },

  /** Abonnement temps réel aux changements de judokas (liste auto). */
  subscribeJudokas: (onChange: () => void): (() => void) => {
    const channel = supabase
      .channel(`judokas-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'judokas' },
        () => onChange()
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  },

  listJudokaCreators: async (): Promise<IpcResult<{ items: string[] }>> => {
    const { data } = await supabase.from('judokas').select('created_by')
    const set = new Set<string>(['Serveur'])
    for (const j of data ?? []) set.add(formatCreatorLabel(j.created_by as string))
    const items = [...set].sort((a, b) => {
      if (a === 'Serveur') return -1
      if (b === 'Serveur') return 1
      return a.localeCompare(b, 'fr')
    })
    return ok({ items })
  },

  deleteJudokaCreator: async (
    username: string,
    keepJudokas: boolean
  ): Promise<IpcResult<{ reassigned: number; deleted: number }>> => {
    if (formatCreatorLabel(username) === 'Serveur') {
      return fail('Impossible de supprimer l\'utilisateur Serveur')
    }
    const label = formatCreatorLabel(username)
    const { data } = await supabase.from('judokas').select('*')
    let reassigned = 0
    let deleted = 0
    for (const row of data ?? []) {
      if (formatCreatorLabel(row.created_by as string) !== label) continue
      if (keepJudokas) {
        await supabase.from('judokas').update({ created_by: 'serveur' }).eq('id', row.id)
        reassigned++
      } else {
        await supabase.from('judokas').delete().eq('id', row.id)
        deleted++
      }
    }
    return ok({ reassigned, deleted })
  },

  resetJudokas: async (opts: {
    scope: 'all' | 'server' | 'client'
    username?: string
  }): Promise<IpcResult<{ deleted: number; scope: string }>> => {
    await requireProfile()
    if (opts.scope === 'all') {
      const { data } = await supabase.from('judokas').select('id')
      const ids = (data ?? []).map((r) => r.id as string)
      if (ids.length) await supabase.from('judokas').delete().in('id', ids)
      return ok({ deleted: ids.length, scope: opts.scope })
    }
    const label = opts.scope === 'server' ? 'Serveur' : formatCreatorLabel(opts.username ?? '')
    const { data } = await supabase.from('judokas').select('id, created_by')
    const toDelete = (data ?? []).filter((r) => formatCreatorLabel(r.created_by as string) === label)
    if (toDelete.length) {
      await supabase.from('judokas').delete().in('id', toDelete.map((r) => r.id as string))
    }
    return ok({ deleted: toDelete.length, scope: opts.scope })
  },

  flushSync: async (): Promise<IpcResult<ClientConnectionStatus>> => judovacClient.getClientStatus(),

  getRegisteredCount: async (): Promise<IpcResult<{ count: number; queueSize: number }>> => {
    const profile = await requireProfile()
    const { count } = await supabase
      .from('judokas')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', profile.username)
    return ok({ count: count ?? 0, queueSize: 0 })
  },

  clearLocalSyncQueue: async (): Promise<IpcResult<{ cleared: number; queueSize: number }>> =>
    ok({ cleared: 0, queueSize: 0 }),

  getLogs: async (limit = 100): Promise<IpcResult<{ items: DashboardStats['recentLogs'] }>> => {
    const { data, error } = await supabase
      .from('system_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return fail(error.message)
    return ok({ items: (data ?? []).map((l) => logRowToEntry(l as never)) })
  },

  clearLogs: async (): Promise<IpcResult<boolean>> => {
    const { error } = await supabase.from('system_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) return fail(error.message)
    return ok(true)
  },

  listUsers: async (): Promise<IpcResult<{ items: UserAccount[] }>> => {
    const { data, error } = await supabase.from('profiles').select('*').order('username')
    if (error) return fail(error.message)
    return ok({ items: (data ?? []).map((p) => profileToUserAccount(p as ProfileRow)) })
  },

  createUser: async (
    username: string,
    displayName?: string,
    password?: string
  ): Promise<IpcResult<import('@shared/types/user-account').CreatedUserAccount>> => {
    try {
      const token = await getAccessToken()
      if (!token) {
        return fail('Session expirée — reconnectez-vous pour créer un utilisateur.')
      }
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ username, displayName, role: 'operator', password })
      })
      const text = await res.text()
      let json: {
        ok?: boolean
        data?: import('@shared/types/user-account').CreatedUserAccount
        error?: string
      } = {}
      try {
        json = text ? (JSON.parse(text) as typeof json) : {}
      } catch {
        return fail(
          res.ok
            ? 'Réponse serveur invalide'
            : `Erreur serveur (${res.status}). Vérifiez SUPABASE_SERVICE_ROLE_KEY sur Vercel.`
        )
      }
      if (!res.ok || !json.ok) {
        return fail(json.error ?? `Création utilisateur échouée (${res.status})`)
      }
      if (!json.data) return fail('Réponse serveur incomplète')
      return ok(json.data)
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Création utilisateur impossible')
    }
  },

  deleteUser: async (username: string): Promise<IpcResult<boolean>> => {
    const token = await getAccessToken()
    if (!token) {
      return fail('Session expirée — reconnectez-vous.')
    }
    const res = await fetch(`/api/admin/users?username=${encodeURIComponent(username)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token ?? ''}` }
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok || !json.ok) return fail(json.error ?? 'Suppression échouée')
    return ok(true)
  },

  savePhotoDataUrl: async (dataUrl: string): Promise<IpcResult<{ path: string; dataUrl?: string }>> => {
    try {
      const path = await uploadDataUrl(PHOTOS_BUCKET, dataUrl, 'judokas')
      return ok({ path, dataUrl })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  importPhotoFile: async (): Promise<IpcResult<{ path: string | null; dataUrl?: string | null }>> => {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/jpeg,image/png,image/webp'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(ok({ path: null, dataUrl: null }))
          return
        }
        try {
          assertPhotoSize(file.size)
        } catch (e) {
          resolve(fail(e instanceof Error ? e.message : String(e)))
          return
        }
        const reader = new FileReader()
        reader.onload = async () => {
          try {
            const dataUrl = reader.result as string
            const res = await judovacClient.savePhotoDataUrl(dataUrl)
            if (!res.ok) resolve(res)
            else resolve(ok({ path: res.data.path, dataUrl: res.data.dataUrl ?? dataUrl }))
          } catch (e) {
            resolve(fail(e instanceof Error ? e.message : String(e)))
          }
        }
        reader.onerror = () => resolve(fail('Lecture fichier impossible'))
        reader.readAsDataURL(file)
      }
      input.click()
    })
  },

  readPhotoDataUrl: async (filePath: string): Promise<IpcResult<{ dataUrl: string }>> => {
    try {
      const dataUrl = await readAnyStorageDataUrl(filePath)
      return ok({ dataUrl })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  getSyncQueue: async (): Promise<
    IpcResult<{
      items: Array<{
        id: string
        operation: string
        payload: unknown
        force?: boolean
        createdAt: string
        attempts: number
        lastError?: string
      }>
    }>
  > => ok({ items: [] }),

  getBadgeTemplate: async (): Promise<IpcResult<BadgeTemplate>> => {
    const activeId = await getActiveTemplateId()
    const { data } = await supabase.from('badge_templates').select('*').eq('id', activeId).maybeSingle()
    if (data) return ok(templateFromRow(data as never))
    return ok(await ensureDefaultTemplate())
  },

  setBadgeTemplate: async (template: BadgeTemplate): Promise<IpcResult<BadgeTemplate>> => {
    const { error } = await supabase.from('badge_templates').upsert({
      id: template.id,
      name: template.name,
      is_default: template.isDefault,
      template,
      updated_at: new Date().toISOString()
    })
    if (error) return fail(error.message)
    return ok(template)
  },

  listBadgeTemplates: async (): Promise<IpcResult<{ items: BadgeTemplate[]; activeId: string }>> => {
    await ensureDefaultTemplate()
    const activeId = await getActiveTemplateId()
    const { data, error } = await supabase.from('badge_templates').select('*').order('name')
    if (error) return fail(error.message)
    return ok({
      items: (data ?? []).map((r) => templateFromRow(r as never)),
      activeId
    })
  },

  createBadgeTemplate: async (name?: string): Promise<IpcResult<BadgeTemplate>> => {
    const template = { ...createDefaultBadgeTemplate(), id: crypto.randomUUID(), name: name ?? 'Nouveau modèle', isDefault: false }
    await supabase.from('badge_templates').insert({
      id: template.id,
      name: template.name,
      is_default: false,
      template
    })
    return ok(template)
  },

  deleteBadgeTemplate: async (id: string): Promise<IpcResult<BadgeTemplate>> => {
    if (id === 'default') return fail('Impossible de supprimer le modèle par défaut')
    const activeId = await getActiveTemplateId()
    await supabase.from('badge_templates').delete().eq('id', id)
    if (activeId === id) {
      await supabase.from('badge_template_meta').update({ active_template_id: 'default' }).eq('id', 'default')
    }
    const res = await judovacClient.getBadgeTemplate()
    return res.ok ? res : fail('Modèle introuvable')
  },

  setActiveBadgeTemplate: async (id: string): Promise<IpcResult<BadgeTemplate>> => {
    await supabase.from('badge_template_meta').upsert({
      id: 'default',
      active_template_id: id,
      updated_at: new Date().toISOString()
    })
    return judovacClient.getBadgeTemplate()
  },

  importBadgeAsset: async (
    kind: 'background' | 'logo'
  ): Promise<IpcResult<{ path: string | null; template?: BadgeTemplate; dataUrl?: string }>> => {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/jpeg,image/png,image/webp'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(ok({ path: null }))
          return
        }
        try {
          assertPhotoSize(file.size)
        } catch (e) {
          resolve(fail(e instanceof Error ? e.message : String(e)))
          return
        }
        const reader = new FileReader()
        reader.onload = async () => {
          try {
            const rawDataUrl = reader.result as string
            const dataUrl = await compressImageDataUrl(rawDataUrl, 1600, 0.88)
            const path = await uploadDataUrl(BADGE_ASSETS_BUCKET, dataUrl, kind)
            const tmplRes = await judovacClient.getBadgeTemplate()
            if (!tmplRes.ok) {
              resolve(fail(tmplRes.error))
              return
            }
            const template = {
              ...tmplRes.data,
              backgroundPath: kind === 'background' ? path : tmplRes.data.backgroundPath,
              logoPath: kind === 'logo' ? path : tmplRes.data.logoPath,
              updatedAt: new Date().toISOString()
            }
            // Mise à jour locale immédiate pour l'aperçu ; l'enregistrement final se fait via « Enregistrer »
            resolve(ok({ path, template, dataUrl }))
          } catch (e) {
            resolve(fail(e instanceof Error ? e.message : String(e)))
          }
        }
        reader.readAsDataURL(file)
      }
      input.click()
    })
  },

  exportBadgesPdf: async (opts: {
    judokaIds?: string[]
    all?: boolean
    createdBy?: string
    perPage?: 4 | 6 | 8 | 'custom'
    customCols?: number
    customRows?: number
  }): Promise<IpcResult<{ path: string; count: number }>> => {
    try {
      const token = await getSessionToken()
      if (!token) return fail('Session expirée — reconnectez-vous.')
      const res = await fetch('/api/pdf/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(opts)
      })
      if (!res.ok) {
        const text = await res.text()
        let errMsg = `Export PDF échoué (${res.status})`
        try {
          const err = JSON.parse(text) as { error?: string }
          if (err.error) errMsg = err.error
        } catch {
          if (text && text.length < 200) errMsg = text
        }
        return fail(errMsg)
      }
      const blob = await res.blob()
      const count = Number(res.headers.get('X-Badge-Count') ?? '0')
      const filename = `badges-${new Date().toISOString().slice(0, 10)}.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      return ok({ path: filename, count })
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Export PDF impossible')
    }
  },

  exportBackup: async (): Promise<
    IpcResult<{ path: string; manifest: { counts: Record<string, number>; checksumSha256: string } }>
  > => {
    const [judokas, settings, templates, users, logs] = await Promise.all([
      supabase.from('judokas').select('*'),
      supabase.from('app_settings').select('*').eq('id', 'default').single(),
      supabase.from('badge_templates').select('*'),
      supabase.from('profiles').select('*'),
      supabase.from('system_logs').select('*').order('created_at', { ascending: false }).limit(500)
    ])
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      judokas: judokas.data ?? [],
      settings: settings.data?.settings ?? createDefaultSettings(),
      badgeTemplates: templates.data ?? [],
      users: users.data ?? [],
      logs: logs.data ?? []
    }
    const json = JSON.stringify(payload, null, 2)
    const filename = `judovac-backup-${new Date().toISOString().slice(0, 10)}.json`
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return ok({
      path: filename,
      manifest: {
        counts: {
          judokas: (judokas.data ?? []).length,
          logs: (logs.data ?? []).length,
          users: (users.data ?? []).length
        },
        checksumSha256: 'web-export'
      }
    })
  },

  pickBackupFile: async (): Promise<
    IpcResult<{ path: string; manifest: { counts: Record<string, number>; createdAt: string } }>
  > => {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.jvac,application/json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return resolve(fail('Aucun fichier sélectionné'))
        const text = await file.text()
        try {
          const data = JSON.parse(text) as { judokas?: unknown[]; exportedAt?: string }
          pendingBackupJson = data as Record<string, unknown>
          resolve(
            ok({
              path: file.name,
              manifest: {
                counts: { judokas: data.judokas?.length ?? 0 },
                createdAt: data.exportedAt ?? new Date().toISOString()
              }
            })
          )
        } catch {
          pendingBackupJson = null
          resolve(fail('Fichier de sauvegarde invalide'))
        }
      }
      input.click()
    })
  },

  importBackup: async (opts: {
    path: string
    mode: 'replace' | 'merge'
  }): Promise<
    IpcResult<{
      path: string
      mode: 'replace' | 'merge'
      manifest: { counts: Record<string, number>; checksumSha256: string }
      mergeStats?: { added: number; skipped: number }
    }>
  > => {
    if (!pendingBackupJson) return fail('Aucune sauvegarde en attente — sélectionnez un fichier')
    try {
      await requireProfile()
      const raw = pendingBackupJson
      const judokas = (raw.judokas as Record<string, unknown>[]) ?? []

      if (opts.mode === 'replace') {
        const { data: existing } = await supabase.from('judokas').select('id')
        const ids = (existing ?? []).map((r) => r.id as string)
        if (ids.length) await supabase.from('judokas').delete().in('id', ids)
      }

      let added = 0
      let skipped = 0
      for (const row of judokas) {
        const id = row.id as string
        if (opts.mode === 'merge') {
          const { data: found } = await supabase.from('judokas').select('id').eq('id', id).maybeSingle()
          if (found) {
            skipped++
            continue
          }
        }
        const { error } = await supabase.from('judokas').upsert(row)
        if (!error) added++
      }

      if (raw.settings) {
        await supabase.from('app_settings').upsert({
          id: 'default',
          settings: raw.settings,
          updated_at: new Date().toISOString()
        })
      }

      pendingBackupJson = null
      return ok({
        path: opts.path,
        mode: opts.mode,
        manifest: { counts: { judokas: judokas.length }, checksumSha256: 'web-import' },
        mergeStats: opts.mode === 'merge' ? { added, skipped } : undefined
      })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  getSettings: async (): Promise<IpcResult<AppSettings>> => {
    const { data } = await supabase.from('app_settings').select('*').eq('id', 'default').single()
    return ok(mergeSettings((data?.settings ?? null) as Partial<AppSettings> | null))
  },

  setSettings: async (patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>> => {
    const current = await judovacClient.getSettings()
    if (!current.ok) return current
    const merged = {
      ...current.data,
      ...patch,
      event: { ...current.data.event, ...patch.event },
      print: { ...current.data.print, ...patch.print },
      ui: { ...current.data.ui, ...patch.ui },
      network: { ...current.data.network, ...patch.network },
      updatedAt: new Date().toISOString()
    }
    const { error } = await supabase.from('app_settings').upsert({
      id: 'default',
      settings: merged,
      updated_at: merged.updatedAt
    })
    if (error) return fail(error.message)
    return ok(merged)
  },

  listPrinters: async (): Promise<IpcResult<{ printers: PrinterInfoLite[] }>> =>
    ok({ printers: [{ name: 'browser', displayName: 'Imprimante navigateur', description: '', isDefault: true, status: 0 }] }),

  getLocalNetworkInfo: async (): Promise<
    IpcResult<{
      addresses: Array<{ address: string; iface: string }>
      preferredAddress: string | null
      port: number
    }>
  > =>
    ok({
      addresses: [{ address: window.location.hostname, iface: 'cloud' }],
      preferredAddress: window.location.hostname,
      port: 443
    }),

  printBadges: async (opts: {
    all?: boolean
    judokaIds?: string[]
    printerName?: string
    copies?: number
    silent?: boolean
    perPage?: 4 | 6 | 8
  }): Promise<IpcResult<{ pdfPath: string; count: number }>> => {
    const res = await judovacClient.exportBadgesPdf({
      all: opts.all,
      judokaIds: opts.judokaIds,
      perPage: opts.perPage ?? 4
    })
    if (!res.ok) return res
    return ok({ pdfPath: res.data.path, count: res.data.count })
  },

  channels: IpcChannels
}

export type JudovacApi = typeof judovacClient

export function installJudovacClient(): void {
  window.judovac = judovacClient
}
