import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Supabase attend l'URL projet seule, sans /rest/v1/. */
function normalizeSupabaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/+$/, '')
}

const supabaseUrl = normalizeSupabaseUrl((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '')
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ''

export const isSupabaseConfigured = Boolean(
  supabaseUrl.startsWith('https://') && supabaseAnonKey.length > 20
)

/** Client unique — null si les variables Vercel / .env sont absentes. */
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : (null as unknown as SupabaseClient)

export type ProfileRow = {
  id: string
  username: string
  display_name: string | null
  role: 'admin' | 'operator'
  active: boolean
  created_at: string
}

export type JudokaRow = {
  id: string
  display_id: string
  last_name: string
  middle_name: string
  first_name: string
  sex: 'M' | 'F'
  birth_date: string
  age: number
  province: string
  city: string
  commune: string
  address: string
  phone: string
  email: string
  club: string
  league: string
  sport_province: string
  grade: string
  belt: string
  category: string
  weight_kg: number | null
  height_cm: number | null
  license_number: string
  affiliation_year: number | null
  photo_path: string | null
  created_at: string
  updated_at: string
  created_by: string
  created_workstation: string
  sync_status: string
  version: number
}
