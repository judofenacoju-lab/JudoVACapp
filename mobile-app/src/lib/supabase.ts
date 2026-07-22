import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'

function env(key: string, fallback = ''): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>
  return (
    (process.env[key] as string | undefined)?.trim() ||
    extra[key] ||
    fallback
  )
}

export const SUPABASE_URL = env(
  'EXPO_PUBLIC_SUPABASE_URL',
  'https://aetitvturtkpowftxyrj.supabase.co'
).replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')

export const SUPABASE_ANON_KEY = env('EXPO_PUBLIC_SUPABASE_ANON_KEY')
export const API_BASE = env('EXPO_PUBLIC_API_BASE', 'https://judo-va-capp.vercel.app').replace(
  /\/+$/,
  ''
)

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
})

export type Profile = {
  id: string
  username: string
  display_name: string | null
  role: 'admin' | 'operator'
  active: boolean
}
