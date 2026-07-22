import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { exportBadgesPdfToBuffer } from '../../core/infrastructure/pdf/badge-pdf-node'
import { createDefaultBadgeTemplate } from '../../shared/types/badge'

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
    middleName: row.middle_name as string,
    firstName: row.first_name as string,
    sex: row.sex as 'M' | 'F',
    birthDate: row.birth_date as string,
    age: row.age as number,
    province: row.province as string,
    city: row.city as string,
    commune: row.commune as string,
    address: row.address as string,
    phone: row.phone as string,
    email: row.email as string,
    club: row.club as string,
    league: row.league as string,
    sportProvince: row.sport_province as string,
    grade: row.grade as string,
    belt: row.belt as string,
    category: row.category as string,
    weightKg: row.weight_kg as number | null,
    heightCm: row.height_cm as number | null,
    licenseNumber: row.license_number as string,
    affiliationYear: row.affiliation_year as number | null,
    photoPath: row.photo_path as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    createdBy: row.created_by as string,
    createdWorkstation: row.created_workstation as string,
    syncStatus: row.sync_status as string,
    version: row.version as number
  }
}

function siteOriginFromReq(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'judo-va-capp.vercel.app'
  return `${proto}://${host}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const auth = await verifyAuth(req)
    if (!auth) return res.status(401).json({ error: 'Non autorisé — reconnectez-vous.' })

    const supabase = getSupabaseAdmin()
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
      judokaIds?: string[]
      all?: boolean
      createdBy?: string
      perPage?: 4 | 6 | 8 | 'custom'
      customCols?: number
      customRows?: number
    }

    let query = supabase.from('judokas').select('*').order('created_at', { ascending: false })

    // Opérateur : uniquement ses judokas. Admin : tous (ou filtre demandé).
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
    let { data: tmplRow } = await supabase
      .from('badge_templates')
      .select('*')
      .eq('id', activeId)
      .maybeSingle()

    if (!tmplRow) {
      const fallback = createDefaultBadgeTemplate()
      await supabase.from('badge_templates').upsert({
        id: 'default',
        name: fallback.name,
        is_default: true,
        template: fallback
      })
      tmplRow = {
        id: 'default',
        name: fallback.name,
        is_default: true,
        template: fallback,
        updated_at: new Date().toISOString()
      }
    }

    const rawTemplate = (tmplRow.template ?? {}) as Record<string, unknown>
    const defaults = createDefaultBadgeTemplate()
    const template = {
      ...defaults,
      ...rawTemplate,
      id: tmplRow.id as string,
      name: (tmplRow.name as string) || defaults.name,
      isDefault: Boolean(tmplRow.is_default),
      updatedAt: (tmplRow.updated_at as string) || defaults.updatedAt,
      size:
        (rawTemplate.size as { widthMm?: number; heightMm?: number })?.widthMm &&
        (rawTemplate.size as { widthMm?: number; heightMm?: number })?.heightMm
          ? (rawTemplate.size as { widthMm: number; heightMm: number })
          : defaults.size,
      layout: (rawTemplate.layout as typeof defaults.layout) ?? defaults.layout,
      colors: { ...defaults.colors, ...((rawTemplate.colors as object) ?? {}) }
    }

    const judokas = (judokaRows ?? []).map(rowToJudoka)
    const supabaseUrl = normalizeSupabaseUrl(
      process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
    )

    const pdfBuffer = await exportBadgesPdfToBuffer({
      template: template as never,
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
