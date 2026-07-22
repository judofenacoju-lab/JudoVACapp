import { createDefaultBadgeTemplate, type BadgeTemplate } from './badge-defaults'
import { API_BASE, supabase, type Profile } from './supabase'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

export type Judoka = {
  id: string
  displayId: string
  lastName: string
  middleName: string
  firstName: string
  sex: 'M' | 'F'
  birthDate: string
  age: number
  province: string
  city: string
  commune: string
  address: string
  phone: string
  email: string
  club: string
  league: string
  sportProvince: string
  grade: string
  belt: string
  category: string
  weightKg: number | null
  heightCm: number | null
  licenseNumber: string
  affiliationYear: number | null
  photoPath: string | null
  createdAt: string
  updatedAt: string
  createdBy: string
  createdWorkstation: string
}

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}
function fail(error: string, code?: string): IpcResult<never> {
  return { ok: false, error, code }
}

function computeAge(birthDate: string): number {
  const [y, m, d] = birthDate.split('-').map(Number)
  if (!y || !m || !d) return 0
  const at = new Date()
  let age = at.getFullYear() - y
  if (at.getMonth() + 1 < m || (at.getMonth() + 1 === m && at.getDate() < d)) age -= 1
  return Math.max(0, age)
}

function rowToJudoka(row: Record<string, unknown>): Judoka {
  return {
    id: row.id as string,
    displayId: row.display_id as string,
    lastName: row.last_name as string,
    middleName: (row.middle_name as string) || '',
    firstName: row.first_name as string,
    sex: row.sex as 'M' | 'F',
    birthDate: row.birth_date as string,
    age: (row.age as number) ?? 0,
    province: (row.province as string) || '',
    city: (row.city as string) || '',
    commune: (row.commune as string) || '',
    address: (row.address as string) || '',
    phone: (row.phone as string) || '',
    email: (row.email as string) || '',
    club: (row.club as string) || '',
    league: (row.league as string) || '',
    sportProvince: (row.sport_province as string) || '',
    grade: (row.grade as string) || '',
    belt: (row.belt as string) || '',
    category: (row.category as string) || '',
    weightKg: (row.weight_kg as number | null) ?? null,
    heightCm: (row.height_cm as number | null) ?? null,
    licenseNumber: (row.license_number as string) || '',
    affiliationYear: (row.affiliation_year as number | null) ?? null,
    photoPath: (row.photo_path as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    createdBy: row.created_by as string,
    createdWorkstation: (row.created_workstation as string) || 'mobile'
  }
}

let cachedProfile: Profile | null = null

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export async function getProfile(): Promise<Profile | null> {
  if (cachedProfile) return cachedProfile
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  cachedProfile = data as Profile | null
  return cachedProfile
}

export function clearProfileCache(): void {
  cachedProfile = null
}

export async function requireProfile(): Promise<Profile> {
  const p = await getProfile()
  if (!p?.active) throw new Error('Session invalide ou compte inactif')
  return p
}

export async function signIn(
  email: string,
  password: string
): Promise<{ error: string | null; role?: 'admin' | 'operator' }> {
  clearProfileCache()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }
  const profile = await getProfile()
  if (!profile?.active) {
    await supabase.auth.signOut()
    return { error: 'Compte inactif' }
  }
  return { error: null, role: profile.role }
}

export async function signOut(): Promise<void> {
  clearProfileCache()
  await supabase.auth.signOut()
}

async function nextDisplayId(): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `JV-${year}-`
  const { data } = await supabase
    .from('judokas')
    .select('display_id')
    .like('display_id', `${prefix}%`)
    .order('display_id', { ascending: false })
    .limit(1)
  const last = data?.[0]?.display_id as string | undefined
  const n = last ? Number(last.slice(prefix.length)) + 1 : 1
  return `${prefix}${String(n).padStart(5, '0')}`
}

export async function listJudokas(): Promise<IpcResult<{ items: Judoka[]; total: number }>> {
  try {
    const profile = await requireProfile()
    let q = supabase.from('judokas').select('*', { count: 'exact' }).order('created_at', {
      ascending: false
    })
    if (profile.role !== 'admin') q = q.eq('created_by', profile.username)
    const { data, count, error } = await q.limit(5000)
    if (error) return fail(error.message)
    return ok({ items: (data ?? []).map((r) => rowToJudoka(r as never)), total: count ?? 0 })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export async function createJudoka(
  body: Partial<Judoka> & {
    lastName: string
    firstName: string
    sex: 'M' | 'F'
    birthDate: string
    force?: boolean
  }
): Promise<IpcResult<{ judoka: Judoka }>> {
  try {
    const profile = await requireProfile()
    const displayId = await nextDisplayId()
    const now = new Date().toISOString()
    const row = {
      id: globalThis.crypto?.randomUUID?.() ?? `jv-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      display_id: displayId,
      last_name: body.lastName.trim(),
      middle_name: body.middleName?.trim() ?? '',
      first_name: body.firstName.trim(),
      sex: body.sex,
      birth_date: body.birthDate,
      age: computeAge(body.birthDate),
      province: body.province ?? '',
      city: body.city ?? '',
      commune: body.commune ?? '',
      address: body.address ?? '',
      phone: body.phone ?? '',
      email: body.email ?? '',
      club: body.club ?? '',
      league: body.league ?? '',
      sport_province: body.sportProvince ?? '',
      grade: body.grade ?? '',
      belt: body.belt ?? '',
      category: body.category ?? '',
      weight_kg: body.weightKg ?? null,
      height_cm: body.heightCm ?? null,
      license_number: body.licenseNumber ?? '',
      affiliation_year: body.affiliationYear ?? new Date().getFullYear(),
      photo_path: body.photoPath ?? null,
      created_by: profile.username,
      created_workstation: 'mobile',
      sync_status: 'synced',
      version: 1,
      created_at: now,
      updated_at: now
    }
    const { data, error } = await supabase.from('judokas').insert(row).select('*').single()
    if (error) return fail(error.message)
    return ok({ judoka: rowToJudoka(data as never) })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export async function updateJudoka(
  id: string,
  patch: Partial<Judoka>
): Promise<IpcResult<{ judoka: Judoka }>> {
  try {
    await requireProfile()
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patch.lastName != null) updates.last_name = patch.lastName
    if (patch.middleName != null) updates.middle_name = patch.middleName
    if (patch.firstName != null) updates.first_name = patch.firstName
    if (patch.sex != null) updates.sex = patch.sex
    if (patch.birthDate != null) {
      updates.birth_date = patch.birthDate
      updates.age = computeAge(patch.birthDate)
    }
    if (patch.province != null) updates.province = patch.province
    if (patch.city != null) updates.city = patch.city
    if (patch.commune != null) updates.commune = patch.commune
    if (patch.address != null) updates.address = patch.address
    if (patch.phone != null) updates.phone = patch.phone
    if (patch.email != null) updates.email = patch.email
    if (patch.club != null) updates.club = patch.club
    if (patch.league != null) updates.league = patch.league
    if (patch.sportProvince != null) updates.sport_province = patch.sportProvince
    if (patch.grade != null) updates.grade = patch.grade
    if (patch.belt != null) updates.belt = patch.belt
    if (patch.category != null) updates.category = patch.category
    if (patch.weightKg !== undefined) updates.weight_kg = patch.weightKg
    if (patch.heightCm !== undefined) updates.height_cm = patch.heightCm
    if (patch.licenseNumber != null) updates.license_number = patch.licenseNumber
    if (patch.affiliationYear !== undefined) updates.affiliation_year = patch.affiliationYear
    if (patch.photoPath !== undefined) updates.photo_path = patch.photoPath

    const { data, error } = await supabase
      .from('judokas')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()
    if (error) return fail(error.message)
    return ok({ judoka: rowToJudoka(data as never) })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export async function deleteJudoka(id: string): Promise<IpcResult<boolean>> {
  const { error } = await supabase.from('judokas').delete().eq('id', id)
  if (error) return fail(error.message)
  return ok(true)
}

export async function uploadPhotoDataUrl(dataUrl: string): Promise<IpcResult<{ path: string }>> {
  try {
    const token = await getAccessToken()
    if (!token) return fail('Session expirée')
    const res = await fetch(`${API_BASE}/api/photos/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ dataUrl, bucket: 'photos', prefix: 'judokas' })
    })
    const json = (await res.json()) as { ok?: boolean; data?: { path: string }; error?: string }
    if (!res.ok || !json.ok || !json.data?.path) return fail(json.error ?? 'Upload échoué')
    return ok({ path: json.data.path })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export async function readPhotoDataUrl(path: string): Promise<IpcResult<{ dataUrl: string }>> {
  try {
    if (path.startsWith('data:')) return ok({ dataUrl: path })
    const token = await getAccessToken()
    if (!token) return fail('Session expirée')
    const res = await fetch(`${API_BASE}/api/photos/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ path })
    })
    const json = (await res.json()) as { ok?: boolean; data?: { dataUrl: string }; error?: string }
    if (!res.ok || !json.ok || !json.data?.dataUrl) return fail(json.error ?? 'Lecture impossible')
    return ok({ dataUrl: json.data.dataUrl })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export async function getDashboardStats(): Promise<
  IpcResult<{
    totalJudokas: number
    judokaByUser: Array<{ username: string; count: number }>
  }>
> {
  try {
    const profile = await requireProfile()
    let q = supabase.from('judokas').select('created_by')
    if (profile.role !== 'admin') q = q.eq('created_by', profile.username)
    const { data, error } = await q
    if (error) return fail(error.message)
    const map = new Map<string, number>()
    for (const row of data ?? []) {
      const u = (row.created_by as string) || '—'
      map.set(u, (map.get(u) ?? 0) + 1)
    }
    const judokaByUser = [...map.entries()]
      .map(([username, count]) => ({ username, count }))
      .sort((a, b) => b.count - a.count)
    return ok({ totalJudokas: data?.length ?? 0, judokaByUser })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export async function getBadgeTemplate(): Promise<IpcResult<BadgeTemplate>> {
  const { data: meta } = await supabase
    .from('badge_template_meta')
    .select('active_template_id')
    .eq('id', 'default')
    .maybeSingle()
  const activeId = meta?.active_template_id ?? 'default'
  const { data } = await supabase.from('badge_templates').select('*').eq('id', activeId).maybeSingle()
  if (data?.template) return ok(data.template as BadgeTemplate)
  const template = createDefaultBadgeTemplate()
  await supabase.from('badge_templates').upsert({
    id: 'default',
    name: template.name,
    is_default: true,
    template,
    updated_at: new Date().toISOString()
  })
  return ok(template)
}

export async function setBadgeTemplate(template: BadgeTemplate): Promise<IpcResult<BadgeTemplate>> {
  const { error } = await supabase.from('badge_templates').upsert({
    id: template.id,
    name: template.name,
    is_default: template.isDefault,
    template,
    updated_at: new Date().toISOString()
  })
  if (error) return fail(error.message)
  return ok(template)
}

export async function listUsers(): Promise<
  IpcResult<{ items: Array<{ id: string; username: string; role: string; active: boolean }> }>
> {
  try {
    const profile = await requireProfile()
    if (profile.role !== 'admin') return fail('Accès admin requis')
    const { data, error } = await supabase.from('profiles').select('*').order('username')
    if (error) return fail(error.message)
    return ok({
      items: (data ?? []).map((p) => ({
        id: p.id as string,
        username: p.username as string,
        role: p.role as string,
        active: Boolean(p.active)
      }))
    })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export async function createUser(input: {
  email: string
  password: string
  username: string
  role?: 'admin' | 'operator'
}): Promise<IpcResult<{ id: string }>> {
  try {
    const token = await getAccessToken()
    if (!token) return fail('Session expirée')
    const res = await fetch(`${API_BASE}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(input)
    })
    const json = (await res.json()) as { ok?: boolean; data?: { id: string }; error?: string }
    if (!res.ok || !json.ok) return fail(json.error ?? 'Création échouée')
    return ok({ id: json.data?.id ?? '' })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export async function exportBackupJson(): Promise<IpcResult<{ json: string; filename: string }>> {
  try {
    await requireProfile()
    const [judokas, settings, templates, users] = await Promise.all([
      supabase.from('judokas').select('*'),
      supabase.from('app_settings').select('*').eq('id', 'default').maybeSingle(),
      supabase.from('badge_templates').select('*'),
      supabase.from('profiles').select('*')
    ])
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      judokas: judokas.data ?? [],
      settings: settings.data?.settings ?? {},
      badgeTemplates: templates.data ?? [],
      users: users.data ?? []
    }
    return ok({
      json: JSON.stringify(payload, null, 2),
      filename: `judovac-backup-${new Date().toISOString().slice(0, 10)}.json`
    })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}
