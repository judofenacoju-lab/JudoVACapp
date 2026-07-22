import type { VercelRequest } from '@vercel/node'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

const BOOTSTRAP_ADMIN_EMAIL = 'judovac@mail.com'

export function normalizeSupabaseUrl(raw: string): string {
  return raw.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
}

export function getSupabaseAdmin(): SupabaseClient {
  const url = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Variables Supabase serveur manquantes (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

type ProfileRow = {
  id: string
  username: string
  display_name: string | null
  role: string
  active: boolean
}

function extractBearerToken(req: VercelRequest): string | null {
  const raw = req.headers.authorization ?? req.headers.Authorization
  if (typeof raw !== 'string' || !raw.startsWith('Bearer ')) return null
  const token = raw.slice(7).trim()
  return token || null
}

function isAdminIdentity(user: User, profile: ProfileRow | null): boolean {
  if (user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) return true
  if (user.user_metadata?.role === 'admin') return true
  if (profile?.role === 'admin' && profile.active) return true
  return false
}

async function ensureAdminProfile(
  supabase: SupabaseClient,
  user: User
): Promise<ProfileRow | null> {
  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (existing?.role === 'admin' && existing.active) {
    return existing as ProfileRow
  }

  const username =
    typeof user.user_metadata?.username === 'string' && user.user_metadata.username.trim()
      ? user.user_metadata.username.trim()
      : 'admin'

  const { data: upserted, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        username,
        display_name:
          typeof user.user_metadata?.display_name === 'string'
            ? user.user_metadata.display_name
            : 'Administrateur',
        role: 'admin',
        active: true
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single()

  if (error) {
    console.error('ensureAdminProfile failed:', error.message)
    if (existing?.active) return existing as ProfileRow
    return null
  }

  return upserted as ProfileRow
}

export async function requireAdmin(req: VercelRequest): Promise<{
  supabase: SupabaseClient
  profile: ProfileRow
  user: User
} | null> {
  const token = extractBearerToken(req)
  if (!token) return null

  const supabase = getSupabaseAdmin()
  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) {
    console.error('requireAdmin getUser failed:', userError?.message ?? 'no user')
    return null
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (!isAdminIdentity(user, profile as ProfileRow | null)) {
    return null
  }

  const adminProfile = await ensureAdminProfile(supabase, user)
  if (!adminProfile?.active || adminProfile.role !== 'admin') {
    return null
  }

  return { supabase, profile: adminProfile, user }
}
