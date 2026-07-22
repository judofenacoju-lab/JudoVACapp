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

function pickBucket(path: string, requested?: string): string {
  if (requested === 'badge-assets' || requested === 'photos') return requested
  if (path.startsWith('background/') || path.startsWith('logo/')) return 'badge-assets'
  return 'photos'
}

function normalizeObjectPath(path: string): string {
  const cleaned = path.replace(/^\/+/, '')
  if (cleaned.startsWith('photos/')) return cleaned.slice('photos/'.length)
  if (cleaned.startsWith('badge-assets/')) return cleaned.slice('badge-assets/'.length)
  return cleaned
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

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
      .select('active')
      .eq('id', user.id)
      .maybeSingle()
    if (!profile?.active) {
      return res.status(403).json({ ok: false, error: 'Compte inactif' })
    }

    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
      path?: string
      bucket?: string
    }

    if (!body?.path || typeof body.path !== 'string') {
      return res.status(400).json({ ok: false, error: 'Chemin image requis' })
    }

    if (body.path.startsWith('data:')) {
      return res.status(200).json({ ok: true, data: { dataUrl: body.path } })
    }

    const objectPath = normalizeObjectPath(body.path)
    const bucket = pickBucket(objectPath, body.bucket)

    const { data, error } = await supabase.storage.from(bucket).download(objectPath)
    if (error || !data) {
      // Essai bucket alternatif
      const alt = bucket === 'photos' ? 'badge-assets' : 'photos'
      const second = await supabase.storage.from(alt).download(objectPath)
      if (second.error || !second.data) {
        return res.status(404).json({
          ok: false,
          error: error?.message ?? second.error?.message ?? 'Image introuvable'
        })
      }
      const buf = Buffer.from(await second.data.arrayBuffer())
      const mime = objectPath.endsWith('.png')
        ? 'image/png'
        : objectPath.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg'
      return res.status(200).json({
        ok: true,
        data: { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, bucket: alt }
      })
    }

    const buf = Buffer.from(await data.arrayBuffer())
    const mime = objectPath.endsWith('.png')
      ? 'image/png'
      : objectPath.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg'
    return res.status(200).json({
      ok: true,
      data: { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, bucket }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur lecture photo'
    console.error('api/photos/read:', message)
    return res.status(500).json({ ok: false, error: message })
  }
}
