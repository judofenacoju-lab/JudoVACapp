import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const id = req.query.id as string | undefined
  const displayId = req.query.displayId as string | undefined

  if (!id || !displayId) {
    return res.status(400).json({ valid: false, error: 'Paramètres id et displayId requis' })
  }

  try {
    const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Configuration Supabase manquante')

    const supabase = createClient(url, key)
    const { data, error } = await supabase
      .from('judokas')
      .select('id, display_id, last_name, first_name, middle_name, club, grade, category, license_number, birth_date')
      .eq('id', id)
      .eq('display_id', displayId)
      .maybeSingle()

    if (error || !data) {
      return res.status(404).json({ valid: false, error: 'Badge non trouvé' })
    }

    return res.status(200).json({
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
        birthDate: data.birth_date
      }
    })
  } catch (e) {
    return res.status(500).json({ valid: false, error: e instanceof Error ? e.message : 'Erreur serveur' })
  }
}
