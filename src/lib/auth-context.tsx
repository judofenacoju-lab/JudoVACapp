import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { ModeConfig } from '@shared/types/mode'
import { isSupabaseConfigured, supabase, type ProfileRow } from './supabase'
import { clearProfileCache, syncAccessToken } from './judovac-client'

interface SignInResult {
  error?: string
  role?: ProfileRow['role']
}

interface AuthState {
  session: Session | null
  profile: ProfileRow | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<SignInResult>
  signOut: () => Promise<void>
  buildModeConfig: () => ModeConfig | null
}

const AuthContext = createContext<AuthState | null>(null)

function buildModeConfigFromProfile(profile: ProfileRow): ModeConfig {
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
}

async function applyModeForProfile(profile: ProfileRow): Promise<void> {
  await window.judovac.setMode(buildModeConfigFromProfile(profile))
}

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
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        console.warn('[auth] Timeout session — affichage login')
        setLoading(false)
      }
    }, 8000)

    void supabase.auth
      .getSession()
      .then(async ({ data: { session: s } }) => {
        if (cancelled) return
        setSession(s)
        syncAccessToken(s?.access_token ?? null)
        if (s?.user) {
          try {
            const p = await loadProfile(s.user.id)
            if (!cancelled) setProfile(p)
          } catch (e) {
            console.warn('[auth] profil:', e)
          }
        }
        if (!cancelled) setLoading(false)
      })
      .catch((e) => {
        console.warn('[auth] getSession:', e)
        if (!cancelled) setLoading(false)
      })
      .finally(() => {
        window.clearTimeout(timeout)
      })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, s) => {
      clearProfileCache()
      syncAccessToken(s?.access_token ?? null)
      setSession(s)
      if (s?.user) {
        try {
          const p = await loadProfile(s.user.id)
          setProfile(p)
        } catch {
          setProfile(null)
        }
      } else {
        setProfile(null)
      }
    })

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string): Promise<SignInResult> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    clearProfileCache()
    const { data: { session: s } } = await supabase.auth.getSession()
    if (!s?.user) return { error: 'Session introuvable après connexion' }

    let p = await loadProfile(s.user.id)
    if (!p) {
      const token = s.access_token
      const bootstrap = await fetch('/api/auth/ensure-profile', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const json = (await bootstrap.json().catch(() => ({}))) as {
        ok?: boolean
        data?: ProfileRow
        error?: string
      }
      if (bootstrap.ok && json.ok && json.data) {
        p = json.data
      } else {
        return {
          error:
            json.error ??
            'Profil absent. Exécutez supabase/migrations/002_fix_profiles_admin.sql dans Supabase → SQL Editor.'
        }
      }
    }
    if (!p.active) return { error: 'Compte désactivé — contactez un administrateur.' }

    setProfile(p)
    setSession(s)
    syncAccessToken(s.access_token)
    await applyModeForProfile(p)
    return { role: p.role }
  }

  async function signOut() {
    clearProfileCache()
    syncAccessToken(null)
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    await window.judovac.clearMode()
  }

  const buildModeConfig = useCallback((): ModeConfig | null => {
    if (!profile) return null
    return buildModeConfigFromProfile(profile)
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
