import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Configuration Supabase manquante')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

/** Crée le profil admin si absent (après auth réussie). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token requis' })
  }

  const token = authHeader.slice(7)
  const admin = getSupabaseAdmin()

  const { data: { user }, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !user) {
    return res.status(401).json({ ok: false, error: 'Token invalide' })
  }

  const { data: existing, error: readErr } = await admin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (readErr) {
    return res.status(500).json({
      ok: false,
      error:
        'Table profiles absente. Exécutez supabase/migrations/002_fix_profiles_admin.sql dans Supabase → SQL Editor.',
      details: readErr.message
    })
  }

  if (existing?.active) {
    return res.status(200).json({ ok: true, data: existing, created: false })
  }

  const isBootstrapAdmin = user.email?.toLowerCase() === 'judovac@mail.com'
  const row = {
    id: user.id,
    username: 'admin',
    display_name: 'Administrateur',
    role: isBootstrapAdmin ? 'admin' : 'operator',
    active: true
  }

  const { data: upserted, error: upsertErr } = await admin
    .from('profiles')
    .upsert(row)
    .select('*')
    .single()

  if (upsertErr) {
    return res.status(500).json({ ok: false, error: upsertErr.message })
  }

  return res.status(200).json({ ok: true, data: upserted, created: true })
}
