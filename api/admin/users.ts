import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

const BOOTSTRAP_ADMIN_EMAIL = 'judovac@mail.com'

type ProfileRow = {
  id: string
  username: string
  display_name: string | null
  role: string
  active: boolean
}

function normalizeSupabaseUrl(raw: string): string {
  return raw.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
}

function getSupabaseAdmin(): SupabaseClient {
  const url = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Variables Supabase serveur manquantes (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

function extractBearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization ?? req.headers.Authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  return token || null
}

/** Accepte « orient » ou « orient@mail.com » → username + email de connexion. */
function normalizeUserIdentity(raw: string): { username: string; email: string } {
  const trimmed = raw.trim()
  const lower = trimmed.toLowerCase()

  if (lower.includes('@')) {
    const [local] = lower.split('@')
    const username = (local ?? '').replace(/[^a-z0-9._-]/g, '') || 'user'
    return { username, email: `${username}@mail.com` }
  }

  const username = lower.replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '') || trimmed
  return { username, email: `${username}@mail.com` }
}

function generatePassword(): string {
  const base = Math.random().toString(36).slice(2, 8)
  return `Jv@${base}1`
}

async function requireAdmin(req: VercelRequest): Promise<{
  supabase: SupabaseClient
  profile: ProfileRow
  user: User
} | null> {
  const token = extractBearerToken(req)
  if (!token) return null

  const supabase = getSupabaseAdmin()
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(token)

  if (userError || !user) return null

  const isBootstrapAdmin = user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  let profile = existing as ProfileRow | null

  if (isBootstrapAdmin && (!profile || profile.role !== 'admin' || !profile.active)) {
    const { data: fixed } = await supabase
      .from('profiles')
      .upsert(
        {
          id: user.id,
          username: 'admin',
          display_name: 'Administrateur',
          role: 'admin',
          active: true
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single()
    profile = (fixed as ProfileRow | null) ?? profile
  }

  if (!profile?.active) return null
  if (profile.role !== 'admin' && !isBootstrapAdmin) return null

  return { supabase, profile, user }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await requireAdmin(req)
    if (!ctx) {
      return res.status(401).json({ ok: false, error: 'Accès admin requis' })
    }

    const { supabase } = ctx

    if (req.method === 'POST') {
      const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
        username?: string
        displayName?: string
        role?: string
        password?: string
      }

      if (!body?.username?.trim()) {
        return res.status(400).json({ ok: false, error: "Nom d'utilisateur requis" })
      }

      const { username: cleanUsername, email } = normalizeUserIdentity(body.username)

      if (!cleanUsername || cleanUsername === 'admin') {
        return res.status(400).json({
          ok: false,
          error: 'Nom d’utilisateur invalide ou réservé (ex. orient, pas admin)'
        })
      }

      const userPassword = body.password?.trim() || generatePassword()
      if (userPassword.length < 6) {
        return res.status(400).json({
          ok: false,
          error: 'Le mot de passe doit contenir au moins 6 caractères'
        })
      }

      const role = body.role === 'admin' ? 'admin' : 'operator'

      const { data: created, error } = await supabase.auth.admin.createUser({
        email,
        password: userPassword,
        email_confirm: true,
        user_metadata: {
          username: cleanUsername,
          display_name: body.displayName ?? '',
          role
        }
      })

      if (error) {
        return res.status(400).json({ ok: false, error: error.message })
      }

      if (!created.user) {
        return res.status(500).json({ ok: false, error: 'Création Auth échouée' })
      }

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: created.user.id,
        username: cleanUsername,
        display_name: body.displayName ?? '',
        role,
        active: true
      })

      if (profileError) {
        return res.status(500).json({
          ok: false,
          error: `Compte Auth créé mais profil échoué : ${profileError.message}`
        })
      }

      return res.status(200).json({
        ok: true,
        data: {
          id: created.user.id,
          username: cleanUsername,
          displayName: body.displayName ?? undefined,
          active: true,
          createdAt: new Date().toISOString(),
          role,
          email,
          password: userPassword
        }
      })
    }

    if (req.method === 'DELETE') {
      const username = String(req.query.username ?? '')
      if (!username) return res.status(400).json({ ok: false, error: 'username requis' })

      if (username.toLowerCase() === 'admin') {
        return res
          .status(400)
          .json({ ok: false, error: 'Le compte administrateur ne peut pas être supprimé' })
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('username', username)
        .maybeSingle()

      if (!profile) return res.status(404).json({ ok: false, error: 'Utilisateur introuvable' })

      if (profile.role === 'admin') {
        return res
          .status(400)
          .json({ ok: false, error: 'Le compte administrateur ne peut pas être supprimé' })
      }

      await supabase.from('profiles').delete().eq('id', profile.id)
      await supabase.auth.admin.deleteUser(profile.id)

      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    if (message.includes('Variables Supabase serveur manquantes')) {
      return res.status(503).json({
        ok: false,
        error:
          'Configuration serveur incomplète. Ajoutez SUPABASE_SERVICE_ROLE_KEY sur Vercel (même projet Supabase que VITE_SUPABASE_URL).'
      })
    }
    console.error('api/admin/users error:', message)
    return res.status(500).json({ ok: false, error: message })
  }
}
