import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Variables Supabase serveur manquantes')
  return createClient(url, key)
}

async function requireAdmin(req: VercelRequest) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const supabase = getSupabaseAdmin()
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin' || !profile.active) return null
  return { supabase, profile }
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

    const email = `${username.trim().toLowerCase()}@judovac.local`
    const tempPassword = password ?? `Jv${Math.random().toString(36).slice(2, 10)}!`

    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { username: username.trim(), display_name: displayName ?? '', role }
    })

    if (error) return res.status(400).json({ ok: false, error: error.message })

    await supabase.from('profiles').upsert({
      id: created.user.id,
      username: username.trim(),
      display_name: displayName ?? '',
      role: role === 'admin' ? 'admin' : 'operator',
      active: true
    })

    return res.status(200).json({
      ok: true,
      data: {
        id: created.user.id,
        username: username.trim(),
        displayName: displayName ?? undefined,
        active: true,
        createdAt: new Date().toISOString(),
        temporaryPassword: tempPassword
      }
    })
  }

  if (req.method === 'DELETE') {
    const username = req.query.username as string
    if (!username) return res.status(400).json({ ok: false, error: 'username requis' })

    const { data: profile } = await supabase.from('profiles').select('id').eq('username', username).single()
    if (!profile) return res.status(404).json({ ok: false, error: 'Utilisateur introuvable' })

    await supabase.from('profiles').delete().eq('id', profile.id)
    await supabase.auth.admin.deleteUser(profile.id)

    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' })
}
