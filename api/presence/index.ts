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

type PresenceMap = Record<string, { username: string; at: string }>

const ONLINE_MS = 2 * 60 * 1000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: 'Token requis' })
    }

    const supabase = getSupabaseAdmin()
    const token = auth.slice(7)
    const {
      data: { user },
      error: userErr
    } = await supabase.auth.getUser(token)
    if (userErr || !user) {
      return res.status(401).json({ ok: false, error: 'Session invalide' })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('username, role, active')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.active) {
      return res.status(403).json({ ok: false, error: 'Compte inactif' })
    }

    const { data: row } = await supabase
      .from('app_settings')
      .select('settings')
      .eq('id', 'default')
      .maybeSingle()

    const settings = (row?.settings ?? {}) as Record<string, unknown>
    const presence = ((settings.presence as PresenceMap | undefined) ?? {}) as PresenceMap
    const now = Date.now()

    // Nettoyer les entrées trop anciennes
    for (const [id, entry] of Object.entries(presence)) {
      if (!entry?.at || now - new Date(entry.at).getTime() > ONLINE_MS * 2) {
        delete presence[id]
      }
    }

    if (req.method === 'POST') {
      // Seuls les opérateurs signalent leur présence
      if (profile.role === 'operator') {
        presence[user.id] = {
          username: profile.username,
          at: new Date().toISOString()
        }
        await supabase.from('app_settings').upsert({
          id: 'default',
          settings: { ...settings, presence },
          updated_at: new Date().toISOString()
        })
      }
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'GET') {
      const online = Object.entries(presence)
        .filter(([, entry]) => entry?.at && now - new Date(entry.at).getTime() <= ONLINE_MS)
        .map(([id, entry]) => ({
          socketId: id,
          username: entry.username,
          workstation: 'web',
          connectedAt: entry.at,
          lastHeartbeatAt: entry.at,
          ip: 'cloud'
        }))
      return res.status(200).json({ ok: true, data: { items: online, count: online.length } })
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur présence'
    console.error('api/presence:', message)
    return res.status(500).json({ ok: false, error: message })
  }
}
