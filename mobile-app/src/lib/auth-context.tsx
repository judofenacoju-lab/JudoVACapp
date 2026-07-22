import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getProfile, signIn as apiSignIn, signOut as apiSignOut, clearProfileCache } from '../lib/client'
import { supabase, type Profile } from '../lib/supabase'

type AuthCtx = {
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh(): Promise<void> {
    clearProfileCache()
    const p = await getProfile()
    setProfile(p)
  }

  useEffect(() => {
    void (async () => {
      await refresh()
      setLoading(false)
    })()
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refresh()
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthCtx>(
    () => ({
      profile,
      loading,
      signIn: async (email, password) => {
        const res = await apiSignIn(email, password)
        if (!res.error) await refresh()
        return { error: res.error }
      },
      signOut: async () => {
        await apiSignOut()
        setProfile(null)
      },
      refresh
    }),
    [profile, loading]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth hors AuthProvider')
  return ctx
}
