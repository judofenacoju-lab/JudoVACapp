import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { defaultBadgeTemplateLite, exportBadgesPdfToBuffer } from '../_lib/badge-pdf'

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

async function verifyAuth(req: VercelRequest) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const supabase = getSupabaseAdmin()
  const {
    data: { user },
    error
  } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile?.active) return null
  return { user, profile }
}

function rowToJudoka(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    displayId: row.display_id as string,
    lastName: row.last_name as string,
    middleName: (row.middle_name as string) || '',
    firstName: row.first_name as string,
    sex: row.sex as string,
    category: (row.category as string) || '',
    weightKg: (row.weight_kg as number | null) ?? null,
    licenseNumber: (row.license_number as string) || '',
    photoPath: (row.photo_path as string | null) ?? null
  }
}

function siteOriginFromReq(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host =
    (req.headers['x-forwarded-host'] as string) || req.headers.host || 'judo-va-capp.vercel.app'
  return `${proto}://${host}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Healthcheck (évite le crash silent sur GET)
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'pdf-export' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const auth = await verifyAuth(req)
    if (!auth) return res.status(401).json({ error: 'Non autorisé — reconnectez-vous.' })

    const supabase = getSupabaseAdmin()
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as {
      judokaIds?: string[]
      all?: boolean
      createdBy?: string
      perPage?: 4 | 6 | 8 | 'custom'
      customCols?: number
      customRows?: number
    }

    let query = supabase.from('judokas').select('*').order('created_at', { ascending: false })

    if (auth.profile.role !== 'admin') {
      query = query.eq('created_by', auth.profile.username)
    } else if (body.judokaIds?.length) {
      query = query.in('id', body.judokaIds)
    } else if (body.createdBy) {
      const label =
        body.createdBy.toLowerCase() === 'serveur' || body.createdBy === 'Serveur'
          ? 'serveur'
          : body.createdBy
      query = query.eq('created_by', label)
    }

    const { data: judokaRows, error: jErr } = await query
    if (jErr) return res.status(500).json({ error: jErr.message })

    const { data: meta } = await supabase
      .from('badge_template_meta')
      .select('active_template_id')
      .eq('id', 'default')
      .maybeSingle()
    const activeId = meta?.active_template_id ?? 'default'
    const { data: tmplRow } = await supabase
      .from('badge_templates')
      .select('*')
      .eq('id', activeId)
      .maybeSingle()

    const defaults = defaultBadgeTemplateLite()
    const raw = (tmplRow?.template ?? {}) as Record<string, unknown>
    const rawSize = raw.size as { widthMm?: number; heightMm?: number } | undefined
    const template = {
      ...defaults,
      ...raw,
      size:
        rawSize?.widthMm && rawSize?.heightMm
          ? { widthMm: rawSize.widthMm, heightMm: rawSize.heightMm }
          : defaults.size,
      colors: { ...defaults.colors, ...((raw.colors as object) ?? {}) },
      layout: (raw.layout as typeof defaults.layout) ?? defaults.layout,
      backgroundPath: (raw.backgroundPath as string | null) ?? null,
      logoPath: (raw.logoPath as string | null) ?? null
    }

    const judokas = (judokaRows ?? []).map(rowToJudoka)
    const supabaseUrl = normalizeSupabaseUrl(
      process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
    )

    const pdfBuffer = await exportBadgesPdfToBuffer({
      template,
      judokas,
      perPage: body.perPage ?? 4,
      customCols: body.customCols,
      customRows: body.customRows,
      supabaseUrl,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      siteOrigin: siteOriginFromReq(req)
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="badges.pdf"')
    res.setHeader('X-Badge-Count', String(judokas.length))
    return res.status(200).send(Buffer.from(pdfBuffer))
  } catch (e) {
    console.error('[api/pdf/export]', e)
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Erreur serveur export PDF'
    })
  }
}
