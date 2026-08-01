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
import { computeAge, hasRecordedWeight, isSameJudokaIdentity, resolveJudokaCategory, setActiveCategoryAgeRanges } from '@shared/utils/judoka'
import { setActiveRegisteredClubs } from '@shared/utils/clubs'
import { formatCreatorLabel, matchesCreatorLabel, resolveCreatedByStorageValue } from '@shared/utils/creator'
import { judokaFormSchema } from '@shared/validation/judoka'
import { createId } from './create-id'
import { supabase, type JudokaRow, type ProfileRow } from './supabase'
import {
  rowToJudoka,
  judokaToRow,
  profileToUserAccount,
  mergeSettings,
  templateFromRow,
  logRowToEntry
} from './mappers'
import { readDurableSession, saveDurableSession } from './durable-session'
import { downloadBlob, downloadBytes } from './download-blob'

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

  // getSession() lit le stockage local — plus fiable que getUser() sur Safari/Mac
  const { data: { session } } = await supabase.auth.getSession()
  let userId = session?.user?.id ?? null
  if (session?.access_token) cachedAccessToken = session.access_token

  if (!userId) {
    const restored = await ensureSupabaseSession()
    if (restored) {
      const { data: { session: s2 } } = await supabase.auth.getSession()
      userId = s2?.user?.id ?? null
      if (s2?.access_token) cachedAccessToken = s2.access_token
    }
  }

  if (!userId && cachedProfile) return cachedProfile
  if (!userId) return null

  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) {
    console.warn('[judovac] getProfile:', error.message)
    return cachedProfile
  }
  cachedProfile = data as ProfileRow | null
  return cachedProfile
}

/**
 * Réinjecte le JWT Supabase depuis la session durable si le client l’a perdu
 * (fréquent sur Chrome Mac → requêtes RLS vides → compteurs à 0).
 * Après F5, refresh_token d'abord (access_token souvent expiré).
 */
async function ensureSupabaseSession(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      cachedAccessToken = session.access_token
      return true
    }

    const durable = readDurableSession()
    if (!durable?.refreshToken) return Boolean(cachedAccessToken)

    // Refresh avant setSession — critique au rechargement de page Mac
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession({
      refresh_token: durable.refreshToken
    })
    if (!refreshErr && refreshed.session?.access_token) {
      cachedAccessToken = refreshed.session.access_token
      syncProfileCache(durable.profile)
      if (refreshed.session.refresh_token) {
        saveDurableSession(
          refreshed.session.access_token,
          refreshed.session.refresh_token,
          durable.profile
        )
      }
      return true
    }

    const { data, error } = await supabase.auth.setSession({
      access_token: durable.accessToken,
      refresh_token: durable.refreshToken
    })

    if (!error && data.session?.access_token) {
      cachedAccessToken = data.session.access_token
      syncProfileCache(durable.profile)
      if (data.session.refresh_token) {
        saveDurableSession(
          data.session.access_token,
          data.session.refresh_token,
          durable.profile
        )
      }
      return true
    }

    console.warn('[judovac] ensureSession:', refreshErr?.message ?? error?.message)
    return false
  } catch (e) {
    console.warn('[judovac] ensureSession:', e)
    return false
  }
}

/** Vide uniquement le profil en mémoire (conserve le token d’accès). */
export function clearProfileCache(): void {
  cachedProfile = null
}

/** Vide profil + token (déconnexion). */
export function clearAuthCache(): void {
  cachedProfile = null
  cachedAccessToken = null
}

export function syncAccessToken(token: string | null): void {
  cachedAccessToken = token
}

/** Alimente le cache profil après login pour éviter un getUser() réseau. */
export function syncProfileCache(profile: ProfileRow | null): void {
  cachedProfile = profile
}

async function getAccessToken(): Promise<string | null> {
  if (cachedAccessToken) return cachedAccessToken

  try {
    await ensureSupabaseSession()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      cachedAccessToken = session.access_token
      return cachedAccessToken
    }
  } catch (e) {
    console.warn('[judovac] getAccessToken:', e)
  }

  return cachedAccessToken
}

async function requireProfile(): Promise<ProfileRow> {
  await ensureSupabaseSession()
  const p = await getProfile()
  if (!p?.active) {
    const durable = readDurableSession()
    if (durable?.profile?.active) {
      syncProfileCache(durable.profile)
      return durable.profile
    }
    throw new Error('Session invalide ou compte désactivé')
  }
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
  middleName?: string
  firstName: string
  birthDate: string
  club?: string
  excludeId?: string
}): Promise<DuplicateMatch[]> {
  await ensureSupabaseSession()
  const { items } = await fetchAllJudokasForProfile()
  const matches: DuplicateMatch[] = []
  for (const j of items) {
    if (candidate.excludeId && j.id === candidate.excludeId) continue
    if (
      !isSameJudokaIdentity(
        {
          lastName: candidate.lastName,
          middleName: candidate.middleName,
          firstName: candidate.firstName,
          birthDate: candidate.birthDate,
          club: candidate.club
        },
        j
      )
    ) {
      continue
    }
    matches.push({
      judoka: j,
      matchedOn: ['name', 'middleName', 'birthDate', 'club']
    })
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

  let payload = dataUrl
  try {
    // Ne pas recompresser si déjà JPEG compressé côté appelant
    if (!dataUrl.includes('image/jpeg') || dataUrl.length > 900_000) {
      payload = await compressImageDataUrl(dataUrl)
    }
  } catch {
    payload = dataUrl
  }
  const approxBytes = Math.ceil(((payload.split(',')[1]?.length ?? 0) * 3) / 4)
  assertPhotoSize(approxBytes)

  const res = await fetch('/api/photos/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ dataUrl: payload, bucket, prefix })
  })
  const text = await res.text()
  let json: { ok?: boolean; data?: { path: string }; error?: string } = {}
  try {
    json = text ? (JSON.parse(text) as typeof json) : {}
  } catch {
    throw new Error(
      res.ok
        ? 'Réponse upload invalide'
        : `Upload échoué (${res.status}). Vérifiez SUPABASE_SERVICE_ROLE_KEY sur Vercel.`
    )
  }
  if (!res.ok || !json.ok || !json.data?.path) {
    throw new Error(json.error ?? 'Upload image échoué')
  }
  return json.data.path
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Lecture image impossible'))
    reader.readAsDataURL(blob)
  })
}

/** Normalise un chemin Storage (retire un éventuel préfixe bucket). */
function normalizeStoragePath(path: string): { bucketHint: string | null; objectPath: string } {
  const cleaned = path.replace(/^\/+/, '')
  if (cleaned.startsWith(`${PHOTOS_BUCKET}/`)) {
    return { bucketHint: PHOTOS_BUCKET, objectPath: cleaned.slice(PHOTOS_BUCKET.length + 1) }
  }
  if (cleaned.startsWith(`${BADGE_ASSETS_BUCKET}/`)) {
    return {
      bucketHint: BADGE_ASSETS_BUCKET,
      objectPath: cleaned.slice(BADGE_ASSETS_BUCKET.length + 1)
    }
  }
  return { bucketHint: null, objectPath: cleaned }
}

async function readStorageDataUrl(bucket: string, objectPath: string): Promise<string> {
  if (objectPath.startsWith('data:')) return objectPath

  const { data, error } = await supabase.storage.from(bucket).download(objectPath)
  if (data && !error) {
    return blobToDataUrl(data)
  }

  // Fallback URL publique (buckets publics)
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPath)
  if (pub?.publicUrl) {
    const res = await fetch(pub.publicUrl)
    if (res.ok) return blobToDataUrl(await res.blob())
  }

  throw new Error(error?.message ?? 'Photo introuvable')
}

/** Lecture via API Vercel (service role) — fiabilise Export/Impression PDF. */
async function readStorageDataUrlViaApi(path: string, bucket?: string): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new Error('Session expirée — reconnectez-vous.')
  const res = await fetch('/api/photos/read', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ path, bucket })
  })
  const text = await res.text()
  let json: { ok?: boolean; data?: { dataUrl?: string }; error?: string } = {}
  try {
    json = text ? (JSON.parse(text) as typeof json) : {}
  } catch {
    throw new Error(`Lecture photo échouée (${res.status})`)
  }
  if (!res.ok || !json.ok || !json.data?.dataUrl) {
    throw new Error(json.error ?? 'Photo introuvable')
  }
  return json.data.dataUrl
}

async function readAnyStorageDataUrl(path: string): Promise<string> {
  if (path.startsWith('data:')) return path
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
    const res = await fetch(path)
    if (!res.ok) throw new Error(`Image inaccessible (${res.status})`)
    return blobToDataUrl(await res.blob())
  }

  const { bucketHint, objectPath } = normalizeStoragePath(path)
  const buckets =
    bucketHint != null
      ? [bucketHint]
      : objectPath.startsWith('background/') || objectPath.startsWith('logo/')
        ? [BADGE_ASSETS_BUCKET, PHOTOS_BUCKET]
        : [PHOTOS_BUCKET, BADGE_ASSETS_BUCKET]

  // API serveur d'abord — plus fiable sur Safari/Chrome Mac (CORS / RLS storage)
  try {
    await ensureSupabaseSession()
    return await readStorageDataUrlViaApi(objectPath, buckets[0])
  } catch {
    /* fallback client */
  }

  let lastError: Error | null = null
  for (const bucket of buckets) {
    try {
      return await readStorageDataUrl(bucket, objectPath)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
    }
  }

  try {
    return await readStorageDataUrlViaApi(objectPath, buckets[0])
  } catch (e) {
    throw lastError ?? (e instanceof Error ? e : new Error(String(e)))
  }
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

async function fetchAllJudokasForDashboard(): Promise<
  Array<{ created_by: string; sex: string; weight_kg: unknown }>
> {
  const authed = await ensureSupabaseSession()
  if (!authed) throw new Error('Session absente — reconnexion du jeton en cours')

  const pageSize = 1000

  // Total exact côté Supabase — évite d’afficher un faux « 1000 » (taille d’une seule page)
  let exactCount: number | null = null
  {
    const first = await supabase.from('judokas').select('id', { count: 'exact', head: true })
    if (first.error) {
      await ensureSupabaseSession()
      const second = await supabase.from('judokas').select('id', { count: 'exact', head: true })
      if (second.error) throw new Error(second.error.message)
      exactCount = second.count
    } else {
      exactCount = first.count
    }
  }
  const expected = exactCount ?? 0
  if (expected === 0) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      throw new Error('Session absente pendant le chargement des judokas')
    }
    return []
  }

  const rows: Array<{ created_by: string; sex: string; weight_kg: unknown }> = []
  let offset = 0
  let emptyPageRetries = 0

  while (rows.length < expected) {
    const { data, error } = await supabase
      .from('judokas')
      .select('created_by, sex, weight_kg')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) {
      const restored = await ensureSupabaseSession()
      if (!restored) throw new Error(error.message)
      const retry = await supabase
        .from('judokas')
        .select('created_by, sex, weight_kg')
        .order('created_at', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (retry.error) throw new Error(retry.error.message)
      const batch = retry.data ?? []
      if (batch.length === 0 && rows.length < expected) {
        emptyPageRetries += 1
        if (emptyPageRetries > 3) {
          throw new Error(
            `Chargement incomplet des judokas (${rows.length}/${expected})`
          )
        }
        await ensureSupabaseSession()
        continue
      }
      emptyPageRetries = 0
      for (const row of batch) {
        rows.push(row as { created_by: string; sex: string; weight_kg: unknown })
      }
      offset += batch.length
      if (batch.length === 0) break
      continue
    }

    const batch = data ?? []
    // Page pleine puis page vide alors qu’il reste des lignes = JWT/RLS flash (affiche souvent 1000)
    if (batch.length === 0 && rows.length < expected) {
      emptyPageRetries += 1
      if (emptyPageRetries > 3) {
        throw new Error(
          `Chargement incomplet des judokas (${rows.length}/${expected})`
        )
      }
      await ensureSupabaseSession()
      continue
    }
    emptyPageRetries = 0
    for (const row of batch) {
      rows.push(row as { created_by: string; sex: string; weight_kg: unknown })
    }
    if (batch.length === 0) break
    offset += batch.length
  }

  if (rows.length < expected) {
    throw new Error(
      `Chargement incomplet des judokas (${rows.length}/${expected}) — nouvel essai`
    )
  }

  return rows
}

const JUDOKA_FETCH_PAGE = 1000

/** Charge tous les judokas visibles pour le profil (pages complètes + retry JWT Mac). */
async function fetchAllJudokasForProfile(): Promise<{ items: Judoka[]; total: number }> {
  await ensureSupabaseSession()
  const profile = await requireProfile()

  let countQ = supabase.from('judokas').select('id', { count: 'exact', head: true })
  if (profile.role !== 'admin') {
    countQ = countQ.eq('created_by', profile.username)
  }
  const { count: exactCount, error: countError } = await countQ
  if (countError) throw new Error(countError.message)
  const expected = exactCount ?? 0
  if (expected === 0) return { items: [], total: 0 }

  const items: Judoka[] = []
  let offset = 0
  let emptyPageRetries = 0

  while (items.length < expected) {
    let q = supabase
      .from('judokas')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + JUDOKA_FETCH_PAGE - 1)
    if (profile.role !== 'admin') {
      q = q.eq('created_by', profile.username)
    }
    const { data, error } = await q

    if (error) {
      const restored = await ensureSupabaseSession()
      if (!restored) throw new Error(error.message)
      emptyPageRetries += 1
      if (emptyPageRetries > 3) {
        throw new Error(`Chargement incomplet des judokas (${items.length}/${expected})`)
      }
      continue
    }

    const batch = (data ?? []).map((r) => rowToJudoka(r as never))
    if (batch.length === 0 && items.length < expected) {
      emptyPageRetries += 1
      if (emptyPageRetries > 3) {
        throw new Error(`Chargement incomplet des judokas (${items.length}/${expected})`)
      }
      await ensureSupabaseSession()
      continue
    }
    emptyPageRetries = 0
    items.push(...batch)
    if (batch.length === 0) break
    offset += batch.length
  }

  if (items.length < expected) {
    throw new Error(`Chargement incomplet des judokas (${items.length}/${expected})`)
  }

  return { items, total: expected }
}

function judokaSearchHaystack(j: Judoka): string {
  return [j.lastName, j.middleName, j.firstName, j.displayId, j.licenseNumber, j.phone, j.club]
    .join(' ')
    .toLowerCase()
}

function judokaSearchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function judokaMatchesSearchQuery(j: Judoka, query: string): boolean {
  const tokens = judokaSearchTokens(query)
  if (tokens.length === 0) return true
  const hay = judokaSearchHaystack(j)
  return tokens.every((t) => hay.includes(t))
}

function filterJudokasBySearch(
  all: Judoka[],
  query: string,
  filters?: Record<string, string>
): Judoka[] {
  return all.filter((j) => {
    if (filters?.club && !j.club.toLowerCase().includes(filters.club.toLowerCase())) return false
    if (filters?.province && !j.province.toLowerCase().includes(filters.province.toLowerCase()))
      return false
    if (filters?.league && !j.league.toLowerCase().includes(filters.league.toLowerCase())) return false
    if (filters?.grade && !j.grade.toLowerCase().includes(filters.grade.toLowerCase())) return false
    if (filters?.phone && !j.phone.includes(filters.phone)) return false
    if (filters?.licenseNumber && !j.licenseNumber.includes(filters.licenseNumber)) return false
    if (filters?.createdBy && formatCreatorLabel(j.createdBy) !== filters.createdBy) return false
    return judokaMatchesSearchQuery(j, query)
  })
}

function ilikeFragment(raw: string): string {
  const safe = raw.replace(/[%_,]/g, ' ').trim()
  return `%${safe}%`
}

/** Liste paginée avec filtres / recherche côté Supabase (affichage rapide). */
async function queryJudokasPaginated(
  query: string,
  filters: Record<string, string> | undefined,
  limit: number,
  offset: number
): Promise<{ items: Judoka[]; total: number }> {
  const profile = await requireProfile()
  let q = supabase
    .from('judokas')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (profile.role !== 'admin') {
    q = q.eq('created_by', profile.username)
  }

  if (filters?.club) q = q.ilike('club', ilikeFragment(filters.club))
  if (filters?.province) q = q.ilike('province', ilikeFragment(filters.province))
  if (filters?.league) q = q.ilike('league', ilikeFragment(filters.league))
  if (filters?.grade) q = q.ilike('grade', ilikeFragment(filters.grade))
  if (filters?.createdBy) {
    if (filters.createdBy === 'Serveur') {
      q = q.or('created_by.is.null,created_by.eq.,created_by.ilike.serveur')
    } else {
      q = q.eq('created_by', filters.createdBy)
    }
  }

  const tokens = judokaSearchTokens(query)
  for (const token of tokens) {
    const pat = ilikeFragment(token)
    q = q.or(
      [
        `last_name.ilike.${pat}`,
        `middle_name.ilike.${pat}`,
        `first_name.ilike.${pat}`,
        `display_id.ilike.${pat}`,
        `license_number.ilike.${pat}`,
        `phone.ilike.${pat}`,
        `club.ilike.${pat}`
      ].join(',')
    )
  }

  const { data, count, error } = await q.range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)
  return {
    items: (data ?? []).map((r) => rowToJudoka(r as never)),
    total: count ?? 0
  }
}

/** Noms de clubs distincts déjà présents sur les fiches judokas (admin). */
async function fetchDistinctJudokaClubNames(): Promise<string[]> {
  const profile = await requireProfile()
  if (profile.role !== 'admin') {
    throw new Error('Réservé au compte Serveur.')
  }
  await ensureSupabaseSession()

  const { count: exactCount, error: countError } = await supabase
    .from('judokas')
    .select('id', { count: 'exact', head: true })
  if (countError) throw new Error(countError.message)
  const expected = exactCount ?? 0

  const seen = new Map<string, string>()
  let offset = 0
  let loaded = 0
  const pageSize = 1000
  let emptyRetries = 0

  while (loaded < expected) {
    const { data, error } = await supabase
      .from('judokas')
      .select('club')
      .range(offset, offset + pageSize - 1)
    if (error) {
      await ensureSupabaseSession()
      emptyRetries += 1
      if (emptyRetries > 3) throw new Error(error.message)
      continue
    }
    const batch = data ?? []
    if (batch.length === 0 && loaded < expected) {
      emptyRetries += 1
      if (emptyRetries > 3) break
      await ensureSupabaseSession()
      continue
    }
    emptyRetries = 0
    for (const row of batch) {
      const name = String((row as { club?: string }).club ?? '').trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (!seen.has(key)) seen.set(key, name)
    }
    loaded += batch.length
    if (batch.length === 0) break
    offset += batch.length
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'))
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
    try {
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
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Statut serveur indisponible')
    }
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
    await ensureSupabaseSession()
    const { data: { session } } = await supabase.auth.getSession()
    return ok({
      connected: !!session || !!cachedAccessToken || !!cachedProfile,
      serverHost: window.location.hostname,
      serverPort: 443,
      lastError: null,
      queueSize: 0,
      lastSyncAt: new Date().toISOString()
    })
  },

  getDashboardStats: async (): Promise<IpcResult<DashboardStats>> => {
    try {
      const profile = await requireProfile()
      if (profile.role === 'operator') {
        void judovacClient.heartbeat()
      }

      let all: Array<{ created_by: string; sex: string; weight_kg: unknown }> = []
      try {
        all = await fetchAllJudokasForDashboard()
      } catch (e) {
        return fail(e instanceof Error ? e.message : 'Impossible de charger les judokas')
      }

      // Opérateur : stats limitées à ses propres enregistrements
      if (profile.role === 'operator') {
        const me = profile.username.trim().toLowerCase()
        all = all.filter((r) => String(r.created_by ?? '').trim().toLowerCase() === me)
      }

      let maleJudokas = 0
      let femaleJudokas = 0
      let weighedJudokas = 0
      let maleWeighedJudokas = 0
      let femaleWeighedJudokas = 0
      const map = new Map<string, number>()
      for (const row of all) {
        const sex = String(row.sex ?? '').toUpperCase()
        const hasWeight = hasRecordedWeight(row.weight_kg)
        if (sex === 'F') {
          femaleJudokas += 1
          if (hasWeight) femaleWeighedJudokas += 1
        } else if (sex === 'M') {
          maleJudokas += 1
          if (hasWeight) maleWeighedJudokas += 1
        }
        if (hasWeight) weighedJudokas += 1
        const label = formatCreatorLabel(row.created_by)
        map.set(label, (map.get(label) ?? 0) + 1)
      }
      if (profile.role === 'admin' && !map.has('Serveur')) map.set('Serveur', 0)
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
        maleJudokas,
        femaleJudokas,
        weighedJudokas,
        maleWeighedJudokas,
        femaleWeighedJudokas,
        connectedClients: online.length,
        networkStatus: 'online',
        pendingSyncCount: 0,
        lastSyncAt: new Date().toISOString(),
        recentLogs: (logs ?? []).map((l) => logRowToEntry(l as never)),
        userActivity: [],
        judokaByUser
      })
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Impossible de charger les statistiques')
    }
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

      const duplicates = await findDuplicates({
        lastName: parsed.data.lastName,
        middleName: parsed.data.middleName,
        firstName: parsed.data.firstName,
        birthDate: parsed.data.birthDate,
        club: parsed.data.club
      })
      if (duplicates.length > 0) {
        const ids = duplicates.map((d) => d.judoka.displayId).join(', ')
        return fail(
          `Doublon bloqué : un judoka avec le même Nom, Postnom, Prénom, Date de naissance et Club existe déjà (${ids}).`,
          'DUPLICATE',
          { duplicates }
        )
      }

      const displayId = await nextDisplayId()
      const now = new Date().toISOString()
      const age = computeAge(parsed.data.birthDate)
      const row = judokaToRow({
        id: createId(),
        displayId,
        ...parsed.data,
        age,
        category: resolveJudokaCategory(parsed.data.birthDate, parsed.data.category),
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
    try {
      await ensureSupabaseSession()
      const { data, error } = await supabase.from('judokas').select('*').eq('id', id).single()
      if (error || !data) return fail(error?.message ?? 'Judoka introuvable')
      return ok(rowToJudoka(data as never))
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  updateJudoka: async (id: string, body: unknown): Promise<IpcResult<unknown>> => {
    try {
      await ensureSupabaseSession()
      const { data: existing, error: fetchErr } = await supabase.from('judokas').select('*').eq('id', id).single()
      if (fetchErr || !existing) return fail('Judoka introuvable')

      const patch = body as Partial<Judoka>
      const birthDate = patch.birthDate ?? (existing as JudokaRow).birth_date
      const age = computeAge(birthDate)
      const category = resolveJudokaCategory(
        birthDate,
        patch.category ?? (existing as JudokaRow).category
      )
      const nextIdentity = {
        lastName: patch.lastName ?? (existing as JudokaRow).last_name,
        middleName: patch.middleName ?? (existing as JudokaRow).middle_name,
        firstName: patch.firstName ?? (existing as JudokaRow).first_name,
        birthDate,
        club: patch.club ?? (existing as JudokaRow).club
      }
      const duplicates = await findDuplicates({
        ...nextIdentity,
        excludeId: id
      })
      if (duplicates.length > 0) {
        const ids = duplicates.map((d) => d.judoka.displayId).join(', ')
        return fail(
          `Doublon bloqué : un judoka avec le même Nom, Postnom, Prénom, Date de naissance et Club existe déjà (${ids}).`,
          'DUPLICATE',
          { duplicates }
        )
      }
      const update = {
        last_name: nextIdentity.lastName,
        middle_name: nextIdentity.middleName,
        first_name: nextIdentity.firstName,
        sex: patch.sex ?? (existing as JudokaRow).sex,
        birth_date: birthDate,
        age,
        province: patch.province ?? (existing as JudokaRow).province,
        city: patch.city ?? (existing as JudokaRow).city,
        commune: patch.commune ?? (existing as JudokaRow).commune,
        address: patch.address ?? (existing as JudokaRow).address,
        phone: patch.phone ?? (existing as JudokaRow).phone,
        email: patch.email ?? (existing as JudokaRow).email,
        club: nextIdentity.club,
        league: patch.league ?? (existing as JudokaRow).league,
        sport_province: patch.sportProvince ?? (existing as JudokaRow).sport_province,
        grade: patch.grade ?? (existing as JudokaRow).grade,
        belt: patch.belt ?? (existing as JudokaRow).belt,
        category,
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
    try {
      await ensureSupabaseSession()
      const { error } = await supabase.from('judokas').delete().eq('id', id)
      if (error) return fail(error.message)
      return ok(true)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  listJudokas: async (opts?: { limit?: number; offset?: number }): Promise<
    IpcResult<{ items: Judoka[]; total: number }>
  > => {
    const limit = opts?.limit ?? 100
    const offset = opts?.offset ?? 0

    if (limit > JUDOKA_FETCH_PAGE) {
      if (offset !== 0) {
        return fail('Utilisez offset 0 pour charger plus de 1000 judokas.')
      }
      try {
        const { items: all, total } = await fetchAllJudokasForProfile()
        return ok({ items: all.slice(0, limit), total })
      } catch (e) {
        return fail(e instanceof Error ? e.message : 'Chargement judokas impossible')
      }
    }

    const profile = await requireProfile()
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
    filters?: Record<string, string>,
    opts?: { limit?: number; offset?: number }
  ): Promise<IpcResult<{ items: Judoka[]; total: number }>> => {
    if (opts && typeof opts.limit === 'number') {
      try {
        const { items, total } = await queryJudokasPaginated(
          query,
          filters,
          opts.limit,
          opts.offset ?? 0
        )
        return ok({ items, total })
      } catch (e) {
        return fail(e instanceof Error ? e.message : 'Recherche impossible')
      }
    }
    try {
      const { items: all, total } = await fetchAllJudokasForProfile()
      const items = filterJudokasBySearch(all, query, filters)
      return ok({ items, total })
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Recherche impossible')
    }
  },

  /** Abonnement temps réel aux changements de judokas (liste auto). */
  subscribeJudokas: (onChange: () => void): (() => void) => {
    const channel = supabase
      .channel(`judokas-${createId()}`)
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
    try {
      await ensureSupabaseSession()
      const { items } = await fetchAllJudokasForProfile()
      const set = new Set<string>(['Serveur'])
      for (const j of items) set.add(formatCreatorLabel(j.createdBy))
      const creators = [...set].sort((a, b) => {
        if (a === 'Serveur') return -1
        if (b === 'Serveur') return 1
        return a.localeCompare(b, 'fr')
      })
      return ok({ items: creators })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  deleteJudokaCreator: async (
    username: string,
    keepJudokas: boolean
  ): Promise<IpcResult<{ reassigned: number; deleted: number }>> => {
    try {
      await ensureSupabaseSession()
      if (formatCreatorLabel(username) === 'Serveur') {
        return fail('Impossible de supprimer l\'utilisateur Serveur')
      }
      const label = formatCreatorLabel(username)
      const { items } = await fetchAllJudokasForProfile()
      let reassigned = 0
      let deleted = 0
      for (const j of items) {
        if (formatCreatorLabel(j.createdBy) !== label) continue
        if (keepJudokas) {
          const { error } = await supabase.from('judokas').update({ created_by: 'serveur' }).eq('id', j.id)
          if (!error) reassigned++
        } else {
          const { error } = await supabase.from('judokas').delete().eq('id', j.id)
          if (!error) deleted++
        }
      }
      return ok({ reassigned, deleted })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  transferUserClubJudokas: async (opts: {
    fromUsername: string
    toUsername: string
    clubName: string
  }): Promise<
    IpcResult<{ transferred: number; club: string; from: string; to: string }>
  > => {
    try {
      const profile = await requireProfile()
      if (profile.role !== 'admin') {
        return fail('Réservé au compte Serveur.')
      }

      const fromLabel = formatCreatorLabel(opts.fromUsername)
      const toLabel = formatCreatorLabel(opts.toUsername)
      if (fromLabel === toLabel) {
        return fail('L’utilisateur source et la destination doivent être différents.')
      }

      const targetClub = opts.clubName.trim() || 'Sans club'
      const targetCreatedBy = resolveCreatedByStorageValue(opts.toUsername)

      const { items: all } = await fetchAllJudokasForProfile()
      const ids = all
        .filter((j) => {
          if (!matchesCreatorLabel(j.createdBy, fromLabel)) return false
          const clubKey = j.club.trim() || 'Sans club'
          return clubKey === targetClub
        })
        .map((j) => j.id)

      if (ids.length === 0) {
        return fail('Aucun judoka à transférer pour ce club.')
      }

      const { error } = await supabase
        .from('judokas')
        .update({ created_by: targetCreatedBy })
        .in('id', ids)
      if (error) return fail(error.message)

      await logSystem(
        'info',
        'judoka.transfer-club',
        `${ids.length} judoka(s) du club « ${targetClub} » transférés de ${fromLabel} vers ${toLabel}`,
        profile.username
      )

      return ok({
        transferred: ids.length,
        club: targetClub,
        from: fromLabel,
        to: toLabel
      })
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Transfert du club impossible')
    }
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
    try {
      await ensureSupabaseSession()
      const { data, error } = await supabase
        .from('system_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) return fail(error.message)
      return ok({ items: (data ?? []).map((l) => logRowToEntry(l as never)) })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },

  clearLogs: async (): Promise<IpcResult<boolean>> => {
    const { error } = await supabase.from('system_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) return fail(error.message)
    return ok(true)
  },

  listUsers: async (): Promise<IpcResult<{ items: UserAccount[] }>> => {
    try {
      await ensureSupabaseSession()
      const { data, error } = await supabase.from('profiles').select('*').order('username')
      if (error) return fail(error.message)
      let items = (data ?? []).map((p) => profileToUserAccount(p as ProfileRow))

    const adminUser = items.find(
      (u) =>
        u.role === 'admin' ||
        u.username.toLowerCase() === 'admin' ||
        u.email?.toLowerCase() === 'judovac@mail.com'
    )
    if (adminUser && !items.some((u) => u.username === 'Serveur')) {
      items = [
        {
          ...adminUser,
          username: 'Serveur',
          displayName: adminUser.displayName ?? 'Serveur'
        },
        ...items.filter((u) => u.id !== adminUser.id)
      ]
    }

    items.sort((a, b) => {
      if (a.username === 'Serveur') return -1
      if (b.username === 'Serveur') return 1
      return a.username.localeCompare(b.username, 'fr')
    })

    return ok({ items })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
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

  resetUserPassword: async (
    username: string,
    password?: string
  ): Promise<IpcResult<import('@shared/types/user-account').CreatedUserAccount>> => {
    try {
      const token = await getAccessToken()
      if (!token) {
        return fail('Session expirée — reconnectez-vous.')
      }
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ username, password })
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
        return fail(json.error ?? `Réinitialisation échouée (${res.status})`)
      }
      if (!json.data) return fail('Réponse serveur incomplète')
      return ok(json.data)
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Réinitialisation impossible')
    }
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
    try {
      await ensureSupabaseSession()
      const activeId = await getActiveTemplateId()
      const { data } = await supabase.from('badge_templates').select('*').eq('id', activeId).maybeSingle()
      if (data) return ok(templateFromRow(data as never))
      return ok(await ensureDefaultTemplate())
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
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
    const template = { ...createDefaultBadgeTemplate(), id: createId(), name: name ?? 'Nouveau modèle', isDefault: false }
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
          resolve(fail('Aucun fichier sélectionné'))
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
            let dataUrl = rawDataUrl
            try {
              dataUrl =
                kind === 'logo'
                  ? await compressImageDataUrl(rawDataUrl, 800, 0.92)
                  : await compressImageDataUrl(rawDataUrl, 1600, 0.85)
            } catch {
              dataUrl = rawDataUrl
            }

            const tmplRes = await judovacClient.getBadgeTemplate()
            if (!tmplRes.ok) {
              resolve(fail(tmplRes.error))
              return
            }

            let path: string = dataUrl
            try {
              path = await uploadDataUrl(BADGE_ASSETS_BUCKET, dataUrl, kind)
            } catch {
              // Aperçu local même si Storage échoue
              path = dataUrl
            }

            const template = {
              ...tmplRes.data,
              backgroundPath: kind === 'background' ? path : tmplRes.data.backgroundPath,
              logoPath: kind === 'logo' ? path : tmplRes.data.logoPath,
              updatedAt: new Date().toISOString()
            }
            // Persiste pour que Export / Impression utilisent le même logo/fond que l’aperçu
            const saved = await judovacClient.setBadgeTemplate(template)
            resolve(
              ok({
                path,
                template: saved.ok ? saved.data : template,
                dataUrl
              })
            )
          } catch (e) {
            resolve(
              fail(
                e instanceof Error
                  ? e.message
                  : `Import ${kind === 'logo' ? 'logo' : 'fond'} impossible`
              )
            )
          }
        }
        reader.onerror = () => resolve(fail('Lecture du fichier image impossible'))
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
      await requireProfile()
      const tmplRes = await judovacClient.getBadgeTemplate()
      if (!tmplRes.ok) return fail(tmplRes.error)

      let items: Judoka[] = []
      if (opts.judokaIds?.length) {
        const listed = await judovacClient.listJudokas({ limit: 5000, offset: 0 })
        if (!listed.ok) return fail(listed.error)
        const idSet = new Set(opts.judokaIds)
        items = listed.data.items.filter((j) => idSet.has(j.id))
      } else if (opts.createdBy) {
        const listed = await judovacClient.listJudokas({ limit: 5000, offset: 0 })
        if (!listed.ok) return fail(listed.error)
        const label =
          opts.createdBy.toLowerCase() === 'serveur' || opts.createdBy === 'Serveur'
            ? 'serveur'
            : opts.createdBy
        items = listed.data.items.filter(
          (j) => j.createdBy.toLowerCase() === label.toLowerCase()
        )
      } else {
        const listed = await judovacClient.listJudokas({ limit: 5000, offset: 0 })
        if (!listed.ok) return fail(listed.error)
        items = listed.data.items
      }

      const { exportBadgesPdfBytes } = await import('./badge-pdf-browser')
      const bytes = await exportBadgesPdfBytes({
        template: tmplRes.data,
        judokas: items,
        perPage: opts.perPage ?? 4,
        customCols: opts.customCols,
        customRows: opts.customRows,
        readDataUrl: async (path) => {
          try {
            // API serveur d'abord (fiable pour les photos Storage)
            return await readStorageDataUrlViaApi(path)
          } catch {
            try {
              return await readAnyStorageDataUrl(path)
            } catch (e) {
              console.warn('[exportBadgesPdf] photo illisible:', path, e)
              return null
            }
          }
        }
      })

      const filename = `badges-${new Date().toISOString().slice(0, 10)}.pdf`
      downloadBytes(bytes, filename, 'application/pdf')
      return ok({ path: filename, count: items.length })
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Export PDF impossible')
    }
  },

  exportBackup: async (): Promise<
    IpcResult<{ path: string; manifest: { counts: Record<string, number>; checksumSha256: string } }>
  > => {
    try {
      await ensureSupabaseSession()
      const profile = await requireProfile()

      const { count: exactCount, error: countError } = await (() => {
        let q = supabase.from('judokas').select('id', { count: 'exact', head: true })
        if (profile.role !== 'admin') q = q.eq('created_by', profile.username)
        return q
      })()
      if (countError) return fail(countError.message)
      const expected = exactCount ?? 0

      const judokaRows: Record<string, unknown>[] = []
      let offset = 0
      let emptyRetries = 0
      while (judokaRows.length < expected) {
        let q = supabase
          .from('judokas')
          .select('*')
          .order('created_at', { ascending: false })
          .range(offset, offset + JUDOKA_FETCH_PAGE - 1)
        if (profile.role !== 'admin') q = q.eq('created_by', profile.username)
        const { data, error } = await q
        if (error) {
          await ensureSupabaseSession()
          emptyRetries += 1
          if (emptyRetries > 3) return fail(error.message)
          continue
        }
        const batch = (data ?? []) as Record<string, unknown>[]
        if (batch.length === 0 && judokaRows.length < expected) {
          emptyRetries += 1
          if (emptyRetries > 3) break
          await ensureSupabaseSession()
          continue
        }
        emptyRetries = 0
        judokaRows.push(...batch)
        if (batch.length === 0) break
        offset += batch.length
      }

      const [settings, templates, users, logs] = await Promise.all([
        supabase.from('app_settings').select('*').eq('id', 'default').single(),
        supabase.from('badge_templates').select('*'),
        supabase.from('profiles').select('*'),
        supabase.from('system_logs').select('*').order('created_at', { ascending: false }).limit(500)
      ])
      const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        judokas: judokaRows,
        settings: settings.data?.settings ?? createDefaultSettings(),
        badgeTemplates: templates.data ?? [],
        users: users.data ?? [],
        logs: logs.data ?? []
      }
      const json = JSON.stringify(payload, null, 2)
      const filename = `judovac-backup-${new Date().toISOString().slice(0, 10)}.json`
      downloadBlob(new Blob([json], { type: 'application/json' }), filename)
      return ok({
        path: filename,
        manifest: {
          counts: {
            judokas: judokaRows.length,
            logs: (logs.data ?? []).length,
            users: (users.data ?? []).length
          },
          checksumSha256: 'web-export'
        }
      })
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Export sauvegarde impossible')
    }
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
    try {
      await ensureSupabaseSession()
      const { data } = await supabase.from('app_settings').select('*').eq('id', 'default').single()
      const settings = mergeSettings((data?.settings ?? null) as Partial<AppSettings> | null)
      setActiveCategoryAgeRanges(settings.categories)
      setActiveRegisteredClubs(settings.clubs)
      return ok(settings)
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Paramètres indisponibles')
    }
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
      categories: patch.categories ?? current.data.categories,
      clubs: patch.clubs ?? current.data.clubs,
      updatedAt: new Date().toISOString()
    }
    const { error } = await supabase.from('app_settings').upsert({
      id: 'default',
      settings: merged,
      updated_at: merged.updatedAt
    })
    if (error) return fail(error.message)
    setActiveCategoryAgeRanges(merged.categories)
    setActiveRegisteredClubs(merged.clubs)
    return ok(merged)
  },

  listJudokaClubNames: async (): Promise<IpcResult<{ items: string[] }>> => {
    try {
      const items = await fetchDistinctJudokaClubNames()
      return ok({ items })
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Liste des clubs impossible')
    }
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
