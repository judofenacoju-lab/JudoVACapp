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

const PROFILE_TIMEOUT_MS = 12_000
const SIGN_IN_TIMEOUT_MS = 20_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${label} (délai ${ms / 1000}s dépassé)`)), ms)
    promise.then(
      (v) => {
        window.clearTimeout(t)
        resolve(v)
      },
      (e) => {
        window.clearTimeout(t)
        reject(e)
      }
    )
  })
}

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
  try {
    await window.judovac.setMode(buildModeConfigFromProfile(profile))
  } catch (e) {
    console.warn('[auth] setMode:', e)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string): Promise<ProfileRow | null> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error) {
      console.warn('[auth] profil query:', error.message)
      return null
    }
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
            const p = await withTimeout(loadProfile(s.user.id), PROFILE_TIMEOUT_MS, 'Chargement du profil')
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
    } = supabase.auth.onAuthStateChange((_event, s) => {
      // Ne jamais await ici : Safari/Mac peut bloquer signInWithPassword
      // tant que le callback async n'a pas fini (deadlock initializePromise).
      clearProfileCache()
      syncAccessToken(s?.access_token ?? null)
      setSession((prev) => {
        if (prev?.access_token === s?.access_token && prev?.user?.id === s?.user?.id) {
          return prev
        }
        return s
      })

      window.setTimeout(() => {
        if (cancelled) return
        void (async () => {
          if (s?.user) {
            try {
              const p = await withTimeout(
                loadProfile(s.user.id),
                PROFILE_TIMEOUT_MS,
                'Chargement du profil'
              )
              if (cancelled) return
              setProfile((prev) => {
                if (
                  prev?.id === p?.id &&
                  prev?.role === p?.role &&
                  prev?.active === p?.active &&
                  prev?.username === p?.username
                ) {
                  return prev
                }
                return p
              })
            } catch (e) {
              console.warn('[auth] onAuthStateChange profil:', e)
            }
          } else {
            setProfile(null)
          }
        })()
      }, 0)
    })

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string): Promise<SignInResult> {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        SIGN_IN_TIMEOUT_MS,
        'Connexion'
      )
      if (error) return { error: error.message }

      // Utiliser la session renvoyée — éviter getSession() juste après (deadlock Safari)
      const s = data.session
      if (!s?.user) return { error: 'Session introuvable après connexion' }

      clearProfileCache()
      syncAccessToken(s.access_token)

      let p = await withTimeout(loadProfile(s.user.id), PROFILE_TIMEOUT_MS, 'Chargement du profil')
      if (!p) {
        const token = s.access_token
        const bootstrap = await withTimeout(
          fetch('/api/auth/ensure-profile', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          }),
          PROFILE_TIMEOUT_MS,
          'Création du profil'
        )
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
      // Ne pas bloquer la navigation sur setMode
      void applyModeForProfile(p)
      return { role: p.role }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connexion impossible'
      console.warn('[auth] signIn:', e)
      return { error: msg }
    }
  }

  async function signOut() {
    clearProfileCache()
    syncAccessToken(null)
    try {
      await withTimeout(supabase.auth.signOut(), 10_000, 'Déconnexion')
    } catch (e) {
      console.warn('[auth] signOut:', e)
    }
    setSession(null)
    setProfile(null)
    try {
      await window.judovac.clearMode()
    } catch (e) {
      console.warn('[auth] clearMode:', e)
    }
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
