import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { ModeConfig } from '@shared/types/mode'
import { isSupabaseConfigured, supabase, type ProfileRow } from './supabase'
import {
  clearAuthCache,
  clearProfileCache,
  syncAccessToken,
  syncProfileCache
} from './judovac-client'

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

function applyProfile(p: ProfileRow | null, setProfile: (p: ProfileRow | null) => void): void {
  syncProfileCache(p)
  setProfile(p)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)
  const profileRef = useRef<ProfileRow | null>(null)

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

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
            if (!cancelled && p) applyProfile(p, setProfile)
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
    } = supabase.auth.onAuthStateChange((event, s) => {
      // Ne jamais await ici : Safari/Mac peut bloquer signInWithPassword.
      if (event === 'SIGNED_OUT' || !s) {
        clearAuthCache()
        setSession(null)
        setProfile(null)
        profileRef.current = null
        return
      }

      syncAccessToken(s.access_token)
      setSession((prev) => {
        if (prev?.access_token === s.access_token && prev?.user?.id === s.user?.id) {
          return prev
        }
        return s
      })

      // TOKEN_REFRESHED : garder le profil actuel, ne pas vider le cache (sinon stats vides)
      if (event === 'TOKEN_REFRESHED' && profileRef.current) {
        return
      }

      window.setTimeout(() => {
        if (cancelled || !s.user) return
        void (async () => {
          try {
            const p = await withTimeout(
              loadProfile(s.user!.id),
              PROFILE_TIMEOUT_MS,
              'Chargement du profil'
            )
            if (cancelled) return
            // Ne jamais écraser un profil valide par null (cause du retour login sur Mac)
            if (!p) {
              console.warn('[auth] profil indisponible — conservation de l’état actuel')
              return
            }
            if (
              profileRef.current?.id === p.id &&
              profileRef.current?.role === p.role &&
              profileRef.current?.active === p.active &&
              profileRef.current?.username === p.username
            ) {
              syncProfileCache(p)
              return
            }
            applyProfile(p, setProfile)
          } catch (e) {
            console.warn('[auth] onAuthStateChange profil:', e)
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

      applyProfile(p, setProfile)
      setSession(s)
      void applyModeForProfile(p)
      return { role: p.role }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connexion impossible'
      console.warn('[auth] signIn:', e)
      return { error: msg }
    }
  }

  async function signOut() {
    clearAuthCache()
    try {
      await withTimeout(supabase.auth.signOut(), 10_000, 'Déconnexion')
    } catch (e) {
      console.warn('[auth] signOut:', e)
    }
    setSession(null)
    setProfile(null)
    profileRef.current = null
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
