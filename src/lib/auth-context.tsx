import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { ModeConfig } from '@shared/types/mode'
import { isSupabaseConfigured, supabase, type ProfileRow } from './supabase'
import {
  clearAuthCache,
  clearProfileCache,
  ensureSupabaseSession,
  syncAccessToken,
  syncProfileCache
} from './judovac-client'
import {
  clearDurableSession,
  isAccessTokenExpired,
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
  sessionReady: boolean
  signIn: (email: string, password: string) => Promise<SignInResult>
  signOut: () => Promise<void>
  buildModeConfig: () => ModeConfig | null
}

const AuthContext = createContext<AuthState | null>(null)

const PROFILE_TIMEOUT_MS = 10_000
const SIGN_IN_TIMEOUT_MS = 20_000
const RESTORE_TIMEOUT_MS = 8_000

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
  const [sessionReady, setSessionReady] = useState(false)
  const sessionRef = useRef<Session | null>(null)
  const profileRef = useRef<ProfileRow | null>(null)
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
    setSessionReady(true)
  }

  function clearUiAuth(): void {
    clearAuthCache()
    setSession(null)
    setProfile(null)
    setSessionReady(false)
    sessionRef.current = null
    profileRef.current = null
  }

  async function loadProfile(userId: string): Promise<ProfileRow | null> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error) {
      console.warn('[auth] profil query:', error.message)
      return null
    }
    return data as ProfileRow | null
  }

  /** S’assure d’un access_token non expiré (Mac). */
  async function ensureFreshSession(s: Session): Promise<Session> {
    if (!isAccessTokenExpired(s.access_token)) return s
    const { data, error } = await withTimeout(
      supabase.auth.refreshSession({ refresh_token: s.refresh_token }),
      RESTORE_TIMEOUT_MS,
      'Refresh session'
    )
    if (!error && data.session) return data.session
    const ok = await ensureSupabaseSession()
    if (ok) {
      const { data: again } = await supabase.auth.getSession()
      if (again.session) return again.session
    }
    return s
  }

  async function restoreFromDurable(): Promise<boolean> {
    const durable = readDurableSession()
    if (!durable?.refreshToken || !durable.profile?.active) return false

    try {
      const { data: refreshed, error: refreshErr } = await withTimeout(
        supabase.auth.refreshSession({ refresh_token: durable.refreshToken }),
        RESTORE_TIMEOUT_MS,
        'Restauration session'
      )
      if (!refreshErr && refreshed.session?.access_token) {
        commitAuth(refreshed.session, durable.profile)
        return true
      }
      console.warn('[auth] refresh restore:', refreshErr?.message)
    } catch (e) {
      console.warn('[auth] refresh restore:', e)
    }

    try {
      const ok = await withTimeout(ensureSupabaseSession(), RESTORE_TIMEOUT_MS, 'ensureSession')
      if (ok) {
        const { data } = await supabase.auth.getSession()
        if (data.session?.user) {
          commitAuth(data.session, durable.profile)
          return true
        }
      }
    } catch (e) {
      console.warn('[auth] ensure restore:', e)
    }

    return false
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        console.warn('[auth] Timeout boot')
        if (!sessionRef.current) clearUiAuth()
        setLoading(false)
      }
    }, 10000)

    void (async () => {
      try {
        let s: Session | null = null
        try {
          const res = await withTimeout(supabase.auth.getSession(), RESTORE_TIMEOUT_MS, 'getSession')
          s = res.data.session
        } catch (e) {
          console.warn('[auth] getSession boot:', e)
        }
        if (cancelled) return

        if (s?.user) {
          s = await ensureFreshSession(s)
          if (cancelled) return
          syncAccessToken(s.access_token)
          let p =
            profileRef.current?.id === s.user.id
              ? profileRef.current
              : await withTimeout(loadProfile(s.user.id), PROFILE_TIMEOUT_MS, 'Chargement du profil').catch(
                  () => null
                )
          if (!p) {
            const durable = readDurableSession()
            if (durable?.profile?.id === s.user.id && durable.profile.active) p = durable.profile
          }
          if (cancelled) return
          if (p?.active) {
            commitAuth(s, p)
            setLoading(false)
            return
          }
        }

        const durableOk = await restoreFromDurable()
        if (cancelled) return
        if (durableOk) {
          setLoading(false)
          return
        }

        clearUiAuth()
      } catch (e) {
        console.warn('[auth] boot:', e)
        if (!sessionRef.current) clearUiAuth()
      } finally {
        window.clearTimeout(timeout)
        if (!cancelled) setLoading(false)
      }
    })()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT') {
        if (!userSigningOutRef.current) {
          console.warn('[auth] SIGNED_OUT parasite — restauration')
          void restoreFromDurable()
          return
        }
        clearDurableSession()
        clearUiAuth()
        return
      }

      if (!nextSession?.user) return

      syncAccessToken(nextSession.access_token)
      setSession((prev) => {
        if (
          prev?.access_token === nextSession.access_token &&
          prev?.user?.id === nextSession.user?.id
        ) {
          return prev
        }
        return nextSession
      })
      sessionRef.current = nextSession
      setSessionReady(true)

      if (event === 'TOKEN_REFRESHED') {
        if (profileRef.current && nextSession.refresh_token) {
          saveDurableSession(
            nextSession.access_token,
            nextSession.refresh_token,
            profileRef.current
          )
        }
        return
      }

      window.setTimeout(() => {
        if (cancelled || !nextSession.user) return
        void (async () => {
          try {
            if (profileRef.current?.id === nextSession.user!.id) {
              syncProfileCache(profileRef.current)
              if (nextSession.refresh_token) {
                saveDurableSession(
                  nextSession.access_token,
                  nextSession.refresh_token,
                  profileRef.current
                )
              }
              return
            }
            const p = await withTimeout(
              loadProfile(nextSession.user!.id),
              PROFILE_TIMEOUT_MS,
              'Chargement du profil'
            )
            if (cancelled || !p) return
            commitAuth(nextSession, p)
          } catch (e) {
            console.warn('[auth] onAuthStateChange profil:', e)
          }
        })()
      }, 0)
    })

    // Keep-alive Mac : refresh JWT au focus / toutes les 3 min
    const keepAlive = () => {
      if (userSigningOutRef.current) return
      void ensureSupabaseSession()
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') keepAlive()
    }
    window.addEventListener('focus', keepAlive)
    document.addEventListener('visibilitychange', onVis)
    const keepAliveId = window.setInterval(keepAlive, 180_000)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      window.clearInterval(keepAliveId)
      window.removeEventListener('focus', keepAlive)
      document.removeEventListener('visibilitychange', onVis)
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
    clearDurableSession()
    clearUiAuth()
    try {
      await withTimeout(supabase.auth.signOut(), 10_000, 'Déconnexion')
    } catch (e) {
      console.warn('[auth] signOut:', e)
    }
    try {
      await window.judovac.clearMode()
    } catch (e) {
      console.warn('[auth] clearMode:', e)
    }
    window.setTimeout(() => {
      userSigningOutRef.current = false
    }, 2000)
  }

  const buildModeConfig = useCallback((): ModeConfig | null => {
    if (!profile) return null
    return buildModeConfigFromProfile(profile)
  }, [profile])

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, sessionReady, signIn, signOut, buildModeConfig }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
