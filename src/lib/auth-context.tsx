import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { ModeConfig } from '@shared/types/mode'
import { isSupabaseConfigured, supabase, type ProfileRow } from './supabase'
import { clearProfileCache } from './judovac-client'

interface AuthState {
  session: Session | null
  profile: ProfileRow | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signOut: () => Promise<void>
  buildModeConfig: () => ModeConfig | null
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string): Promise<ProfileRow | null> {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    return data as ProfileRow | null
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let cancelled = false

    void supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (cancelled) return
      setSession(s)
      if (s?.user) {
        const p = await loadProfile(s.user.id)
        if (!cancelled) setProfile(p)
      }
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      clearProfileCache()
      setSession(s)
      if (s?.user) {
        const p = await loadProfile(s.user.id)
        setProfile(p)
      } else {
        setProfile(null)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    clearProfileCache()
    const { data: { session: s } } = await supabase.auth.getSession()
    if (s?.user) {
      const p = await loadProfile(s.user.id)
      setProfile(p)
      setSession(s)
    }
    return {}
  }

  async function signOut() {
    clearProfileCache()
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    await window.judovac.clearMode()
  }

  const buildModeConfig = useCallback((): ModeConfig | null => {
    if (!profile) return null
    if (profile.role === 'admin') {
      return { mode: 'server', configuredAt: new Date().toISOString() }
    }
    return {
      mode: 'client',
      username: profile.username,
      workstation: 'web',
      serverHost: window.location.hostname,
      serverPort: 443,
      configuredAt: new Date().toISOString()
    }
  }, [profile])

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signOut, buildModeConfig }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
