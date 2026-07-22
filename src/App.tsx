import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { ModeConfig } from '@shared/types/mode'
import { useAuth } from '@/lib/auth-context'
import { isSupabaseConfigured } from '@/lib/supabase'
import { LoginPage } from './pages/LoginPage'
import { ServerDashboardPage } from './pages/ServerDashboardPage'
import { ClientDashboardPage } from './pages/ClientDashboardPage'
import { ConfigErrorPage } from './components/ConfigErrorPage'
import { LoadingScreen, LOADING_DURATION_MS } from './components/LoadingScreen'

type BootState = 'loading' | 'ready'

function ProtectedRoute({
  children,
  requiredRole
}: {
  children: ReactNode
  requiredRole?: 'admin' | 'operator'
}) {
  const { session, profile, loading } = useAuth()

  if (loading) return <LoadingScreen />
  if (!session || !profile?.active) return <Navigate to="/login" replace />
  if (requiredRole && profile.role !== requiredRole && requiredRole === 'admin') {
    return <Navigate to="/app" replace />
  }
  return <>{children}</>
}

export default function App() {
  const { session, profile, loading, buildModeConfig, signOut } = useAuth()
  const [boot, setBoot] = useState<BootState>('loading')
  const [mode, setMode] = useState<ModeConfig | null>(null)

  useEffect(() => {
    if (loading) return
    let cancelled = false

    void (async () => {
      if (session && profile?.active) {
        const cfg = buildModeConfig()
        if (cfg) {
          await window.judovac.setMode(cfg)
          if (!cancelled) setMode(cfg)
        }
      } else {
        await window.judovac.clearMode()
        if (!cancelled) setMode(null)
      }

      const minDelay = new Promise<void>((resolve) => setTimeout(resolve, LOADING_DURATION_MS))
      await minDelay
      if (!cancelled) setBoot('ready')
    })()

    return () => {
      cancelled = true
    }
  }, [loading, session, profile, buildModeConfig])

  if (!isSupabaseConfigured) return <ConfigErrorPage />
  if (loading || boot === 'loading') return <LoadingScreen />

  return (
    <Routes>
      <Route
        path="/login"
        element={session && profile?.active ? <Navigate to={profile.role === 'admin' ? '/dashboard' : '/app'} replace /> : <LoginPage />}
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute requiredRole="admin">
            {mode?.mode === 'server' ? (
              <ServerDashboardPage
                mode={mode}
                onResetMode={async () => {
                  await signOut()
                  setMode(null)
                }}
              />
            ) : profile?.role === 'admin' ? (
              <LoadingScreen />
            ) : (
              <Navigate to="/login" replace />
            )}
          </ProtectedRoute>
        }
      />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            {mode?.mode === 'client' ? (
              <ClientDashboardPage
                mode={mode}
                onResetMode={async () => {
                  await signOut()
                  setMode(null)
                }}
              />
            ) : profile?.role === 'admin' ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Navigate to="/login" replace />
            )}
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <Navigate
            to={
              !session
                ? '/login'
                : profile?.role === 'admin'
                  ? '/dashboard'
                  : '/app'
            }
            replace
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
