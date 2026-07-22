import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function normalizeSupabaseUrl(raw: string): string {
  return raw.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
}

function getSupabaseAdmin() {
  const url = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Variables Supabase serveur manquantes')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

async function requireAdmin(req: VercelRequest) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const supabase = getSupabaseAdmin()
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return null

  const isBootstrapAdmin = user.email?.toLowerCase() === 'judovac@mail.com'
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  if (isBootstrapAdmin && (!profile || profile.role !== 'admin' || !profile.active)) {
    const { data: fixed } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        username: 'admin',
        display_name: 'Administrateur',
        role: 'admin',
        active: true
      })
      .select('*')
      .single()
    if (fixed?.active && fixed.role === 'admin') {
      return { supabase, profile: fixed }
    }
  }

  if (!profile || !profile.active) return null
  if (profile.role !== 'admin' && !isBootstrapAdmin) return null
  return { supabase, profile }
}

function toLoginEmail(username: string): string {
  const slug = username.trim().toLowerCase().replace(/\s+/g, '')
  return `${slug}@mail.com`
}

function generatePassword(): string {
  const base = Math.random().toString(36).slice(2, 8)
  return `Jv@${base}1`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdmin(req)
  if (!ctx) return res.status(401).json({ ok: false, error: 'Accès admin requis' })

  const { supabase } = ctx

  if (req.method === 'POST') {
    const { username, displayName, role = 'operator', password } = req.body as {
      username?: string
      displayName?: string
      role?: string
      password?: string
    }

    if (!username?.trim()) {
      return res.status(400).json({ ok: false, error: 'Nom d\'utilisateur requis' })
    }

    const cleanUsername = username.trim()
    if (cleanUsername.toLowerCase() === 'admin') {
      return res.status(400).json({ ok: false, error: 'Le nom « admin » est réservé' })
    }

    const email = toLoginEmail(cleanUsername)
    const userPassword = password?.trim() || generatePassword()

    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password: userPassword,
      email_confirm: true,
      user_metadata: {
        username: cleanUsername,
        display_name: displayName ?? '',
        role: role === 'admin' ? 'admin' : 'operator'
      }
    })

    if (error) return res.status(400).json({ ok: false, error: error.message })

    await supabase.from('profiles').upsert({
      id: created.user.id,
      username: cleanUsername,
      display_name: displayName ?? '',
      role: role === 'admin' ? 'admin' : 'operator',
      active: true
    })

    return res.status(200).json({
      ok: true,
      data: {
        id: created.user.id,
        username: cleanUsername,
        displayName: displayName ?? undefined,
        active: true,
        createdAt: new Date().toISOString(),
        role: role === 'admin' ? 'admin' : 'operator',
        email,
        password: userPassword
      }
    })
  }

  if (req.method === 'DELETE') {
    const username = req.query.username as string
    if (!username) return res.status(400).json({ ok: false, error: 'username requis' })

    if (username.toLowerCase() === 'admin') {
      return res.status(400).json({ ok: false, error: 'Le compte administrateur ne peut pas être supprimé' })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('username', username)
      .single()

    if (!profile) return res.status(404).json({ ok: false, error: 'Utilisateur introuvable' })

    if (profile.role === 'admin') {
      return res.status(400).json({ ok: false, error: 'Le compte administrateur ne peut pas être supprimé' })
    }

    await supabase.from('profiles').delete().eq('id', profile.id)
    await supabase.auth.admin.deleteUser(profile.id)

    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' })
}
