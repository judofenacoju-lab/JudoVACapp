import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

function normalizeSupabaseUrl(raw: string): string {
  return raw.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
}

function formatName(firstName: string, lastName: string): string {
  const first = (firstName ?? '').trim()
  const last = (lastName ?? '').trim()
  if (first && last) return `${first} ${last}`
  return first || last
}

/**
 * Vérification badge QR — contrat scanner mobile :
 * `{ ok: true, badge: { fullName, category, weight, sex, displayId } }`
 * Accepte `id` et/ou `displayId`.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const id = (req.query.id as string | undefined)?.trim() || undefined
  const displayId = (req.query.displayId as string | undefined)?.trim() || undefined

  if (!id && !displayId) {
    return res.status(400).json({ ok: false, error: 'Paramètre id ou displayId requis' })
  }

  try {
    const url = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '')
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Configuration Supabase manquante')

    const supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    let query = supabase
      .from('judokas')
      .select(
        'id, display_id, last_name, first_name, middle_name, sex, category, weight_kg, club, grade, license_number, birth_date'
      )

    if (id && displayId) {
      query = query.eq('id', id).eq('display_id', displayId)
    } else if (id) {
      query = query.eq('id', id)
    } else {
      query = query.eq('display_id', displayId!)
    }

    const { data, error } = await query.maybeSingle()

    if (error || !data) {
      return res.status(404).json({ ok: false, error: 'Badge non reconnu' })
    }

    const badge = {
      fullName: formatName(data.first_name as string, data.last_name as string),
      category: (data.category as string) || '',
      weight: data.weight_kg != null ? `${data.weight_kg} kg` : '',
      sex: (data.sex as 'M' | 'F') || 'M',
      displayId: data.display_id as string
    }

    return res.status(200).json({
      ok: true,
      badge,
      // Compat éventuelle anciens clients
      valid: true,
      judoka: {
        id: data.id,
        displayId: data.display_id,
        lastName: data.last_name,
        firstName: data.first_name,
        middleName: data.middle_name,
        club: data.club,
        grade: data.grade,
        category: data.category,
        licenseNumber: data.license_number,
        birthDate: data.birth_date,
        sex: data.sex,
        weightKg: data.weight_kg
      }
    })
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : 'Erreur serveur'
    })
  }
}
