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

function applyProfile(p: ProfileRow, setProfile: (p: ProfileRow | null) => void): void {
  syncProfileCache(p)
  setProfile(p)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)
  const sessionRef = useRef<Session | null>(null)
  const profileRef = useRef<ProfileRow | null>(null)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

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

        // Sur Mac, getSession peut arriver APRÈS signIn : ne jamais écraser une session active.
        if (!s) {
          if (!sessionRef.current) {
            setSession(null)
            syncAccessToken(null)
          }
          if (!cancelled) setLoading(false)
          return
        }

        if (
          sessionRef.current &&
          sessionRef.current.user?.id === s.user?.id &&
          sessionRef.current.access_token
        ) {
          // Login déjà en place — juste s’assurer du token / profil
          syncAccessToken(sessionRef.current.access_token)
          if (!profileRef.current) {
            try {
              const p = await withTimeout(loadProfile(s.user.id), PROFILE_TIMEOUT_MS, 'Chargement du profil')
              if (!cancelled && p) applyProfile(p, setProfile)
            } catch (e) {
              console.warn('[auth] profil:', e)
            }
          }
          if (!cancelled) setLoading(false)
          return
        }

        setSession(s)
        syncAccessToken(s.access_token)
        try {
          const p = await withTimeout(loadProfile(s.user.id), PROFILE_TIMEOUT_MS, 'Chargement du profil')
          if (!cancelled && p) applyProfile(p, setProfile)
        } catch (e) {
          console.warn('[auth] profil:', e)
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

      // Uniquement une vraie déconnexion — ignorer les sessions null transitoires (refresh).
      if (event === 'SIGNED_OUT') {
        clearAuthCache()
        setSession(null)
        setProfile(null)
        sessionRef.current = null
        profileRef.current = null
        return
      }

      if (!s?.user) {
        console.warn('[auth] événement sans session ignoré:', event)
        return
      }

      syncAccessToken(s.access_token)
      setSession((prev) => {
        if (prev?.access_token === s.access_token && prev?.user?.id === s.user?.id) {
          return prev
        }
        return s
      })
      sessionRef.current = s

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

      // Marquer avant setState pour gagner la course contre getSession() de boot
      sessionRef.current = s
      profileRef.current = p
      applyProfile(p, setProfile)
      setSession(s)
      setLoading(false)
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
    sessionRef.current = null
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
