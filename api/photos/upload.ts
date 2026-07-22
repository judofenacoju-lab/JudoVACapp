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

async function ensureBucket(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  id: string
): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets()
  if (buckets?.some((b) => b.id === id || b.name === id)) return
    const { error } = await supabase.storage.createBucket(id, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
  })
  // Ignore "already exists" races
  if (error && !/already|exists|duplicate/i.test(error.message)) {
    throw new Error(`Création bucket « ${id} » : ${error.message}`)
  }
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
      dataUrl?: string
      bucket?: string
      prefix?: string
    }

    if (!body?.dataUrl?.startsWith('data:')) {
      return res.status(400).json({ ok: false, error: 'dataUrl image requis' })
    }

    const match = /^data:([^;]+);base64,(.+)$/.exec(body.dataUrl)
    if (!match) {
      return res.status(400).json({ ok: false, error: 'Format image invalide' })
    }

    const mime = match[1]!
    if (!mime.startsWith('image/')) {
      return res.status(400).json({ ok: false, error: 'Fichier image uniquement' })
    }

    const bucket = body.bucket === 'badge-assets' ? 'badge-assets' : 'photos'
    const prefix = (body.prefix ?? 'judokas').replace(/[^a-z0-9/_-]/gi, '') || 'judokas'
    await ensureBucket(supabase, bucket)

    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
    const path = `${prefix}/${crypto.randomUUID()}.${ext}`
    const bytes = Buffer.from(match[2]!, 'base64')

    const { error: uploadErr } = await supabase.storage.from(bucket).upload(path, bytes, {
      contentType: mime,
      upsert: false
    })

    if (uploadErr) {
      return res.status(400).json({ ok: false, error: uploadErr.message })
    }

    return res.status(200).json({
      ok: true,
      data: { path, dataUrl: body.dataUrl, bucket }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur upload'
    if (message.includes('Variables Supabase')) {
      return res.status(503).json({
        ok: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY manquante sur Vercel'
      })
    }
    console.error('api/photos/upload:', message)
    return res.status(500).json({ ok: false, error: message })
  }
}
