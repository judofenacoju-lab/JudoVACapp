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
import {
  clearDurableSession,
  readDurableSession,
  saveDurableSession
} from './durable-session'

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
  const sessionRef = useRef<Session | null>(null)
  const profileRef = useRef<ProfileRow | null>(null)
  /** true uniquement pendant un clic Déconnexion — ignore les SIGNED_OUT parasites. */
  const userSigningOutRef = useRef(false)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  function commitAuth(s: Session, p: ProfileRow): void {
    sessionRef.current = s
    profileRef.current = p
    syncAccessToken(s.access_token)
    syncProfileCache(p)
    if (s.refresh_token) {
      saveDurableSession(s.access_token, s.refresh_token, p)
    }
    setSession(s)
    setProfile(p)
  }

  async function loadProfile(userId: string): Promise<ProfileRow | null> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error) {
      console.warn('[auth] profil query:', error.message)
      return null
    }
    return data as ProfileRow | null
  }

  async function restoreFromDurable(): Promise<boolean> {
    const durable = readDurableSession()
    if (!durable?.refreshToken || !durable.profile?.active) return false

    syncProfileCache(durable.profile)
    syncAccessToken(durable.accessToken)
    profileRef.current = durable.profile
    setProfile(durable.profile)

    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: durable.accessToken,
        refresh_token: durable.refreshToken
      })
      if (error || !data.session) {
        console.warn('[auth] restore setSession:', error?.message)
        return Boolean(durable.profile.active)
      }
      commitAuth(data.session, durable.profile)
      return true
    } catch (e) {
      console.warn('[auth] restore:', e)
      return Boolean(durable.profile.active)
    }
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

    void (async () => {
      try {
        const { data: { session: s } } = await supabase.auth.getSession()
        if (cancelled) return

        // Ne jamais écraser un login déjà établi
        if (sessionRef.current?.access_token && profileRef.current) {
          setLoading(false)
          return
        }

        if (s?.user) {
          syncAccessToken(s.access_token)
          let p = profileRef.current
          if (!p || p.id !== s.user.id) {
            p = await withTimeout(loadProfile(s.user.id), PROFILE_TIMEOUT_MS, 'Chargement du profil')
          }
          if (cancelled) return
          if (p?.active) {
            commitAuth(s, p)
          } else {
            const restored = await restoreFromDurable()
            if (!restored && !sessionRef.current) {
              setSession(null)
            }
          }
        } else {
          const restored = await restoreFromDurable()
          if (!restored && !sessionRef.current) {
            setSession(null)
          }
        }
      } catch (e) {
        console.warn('[auth] boot:', e)
        if (!sessionRef.current) {
          await restoreFromDurable()
        }
      } finally {
        window.clearTimeout(timeout)
        if (!cancelled) setLoading(false)
      }
    })()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') {
        // Déconnexion UI uniquement si l’utilisateur a cliqué « Déconnexion »
        if (!userSigningOutRef.current) {
          console.warn('[auth] SIGNED_OUT parasite ignoré — restauration session')
          void (async () => {
            const ok = await restoreFromDurable()
            if (!ok) {
              const { data } = await supabase.auth.getSession()
              if (data.session?.user && profileRef.current) {
                commitAuth(data.session, profileRef.current)
              }
            }
          })()
          return
        }
        clearAuthCache()
        clearDurableSession()
        setSession(null)
        setProfile(null)
        sessionRef.current = null
        profileRef.current = null
        return
      }

      if (!s?.user) return

      syncAccessToken(s.access_token)
      setSession((prev) => {
        if (prev?.access_token === s.access_token && prev?.user?.id === s.user?.id) return prev
        return s
      })
      sessionRef.current = s

      if (event === 'TOKEN_REFRESHED') {
        if (profileRef.current && s.refresh_token) {
          saveDurableSession(s.access_token, s.refresh_token, profileRef.current)
        }
        return
      }

      window.setTimeout(() => {
        if (cancelled || !s.user) return
        void (async () => {
          try {
            if (profileRef.current?.id === s.user!.id) {
              syncProfileCache(profileRef.current)
              if (s.refresh_token) {
                saveDurableSession(s.access_token, s.refresh_token, profileRef.current)
              }
              return
            }
            const p = await withTimeout(
              loadProfile(s.user!.id),
              PROFILE_TIMEOUT_MS,
              'Chargement du profil'
            )
            if (cancelled || !p) return
            commitAuth(s, p)
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
      userSigningOutRef.current = false
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

      commitAuth(s, p)
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
    userSigningOutRef.current = true
    clearAuthCache()
    clearDurableSession()
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
    // Laisser le flag un court instant pour absorber le SIGNED_OUT async
    window.setTimeout(() => {
      userSigningOutRef.current = false
    }, 2000)
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
