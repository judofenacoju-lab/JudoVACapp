import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[JudoVACapp] VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY requis — configurez .env.local'
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
})

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
