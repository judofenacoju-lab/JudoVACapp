import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { ModeConfig } from '@shared/types/mode'
import { useAuth } from '@/lib/auth-context'
import { isSupabaseConfigured } from '@/lib/supabase'
import { LoginPage } from './pages/LoginPage'
import { ServerDashboardPage } from './pages/ServerDashboardPage'
import { ClientDashboardPage } from './pages/ClientDashboardPage'
import { ConfigErrorPage } from './components/ConfigErrorPage'
import { LoadingScreen } from './components/LoadingScreen'

function ProtectedRoute({
  children,
  requiredRole
}: {
  children: ReactNode
  requiredRole?: 'admin' | 'operator'
}) {
  const { profile, loading, sessionReady } = useAuth()

  if (loading) return <LoadingScreen />
  if (!profile?.active) return <Navigate to="/login" replace />
  // Attendre un JWT utilisable avant d’afficher le dashboard (sinon stats à 0 après F5 Mac)
  if (!sessionReady) return <LoadingScreen />
  if (requiredRole && profile.role !== requiredRole && requiredRole === 'admin') {
    return <Navigate to="/app" replace />
  }
  return <>{children}</>
}

export default function App() {
  const { profile, loading, buildModeConfig, signOut } = useAuth()
  const [bootReady, setBootReady] = useState(false)
  const [mode, setMode] = useState<ModeConfig | null>(null)
  const modeKeyRef = useRef<string>('')

  // Charger les tranches de catégorie dès le démarrage
  useEffect(() => {
    void window.judovac.getSettings()
  }, [])

  // Gate unique : dès que l'auth a répondu, sortir du splash (pas de dépendance session/profile)
  useEffect(() => {
    if (loading) return
    setBootReady(true)
  }, [loading])

  // Filet de sécurité tablette : jamais bloqué plus de 2,5 s
  useEffect(() => {
    const t = window.setTimeout(() => setBootReady(true), 2500)
    return () => window.clearTimeout(t)
  }, [])

  // Sync mode — effet séparé, ne bloque pas l'UI
  useEffect(() => {
    if (loading) return
    if (!profile) return

    const cfg = profile.active ? buildModeConfig() : null
    const key = cfg
      ? `${cfg.mode}:${cfg.mode === 'client' ? cfg.username : 'server'}`
      : 'none'
    if (key === modeKeyRef.current) return
    modeKeyRef.current = key
    if (cfg) setMode(cfg)

    void (async () => {
      try {
        if (cfg) await window.judovac.setMode(cfg)
        else if (!profile) await window.judovac.clearMode()
      } catch (e) {
        console.warn('[App] mode sync:', e)
      }
    })()
  }, [loading, profile, buildModeConfig])

  if (!isSupabaseConfigured) return <ConfigErrorPage />
  if (loading || !bootReady) return <LoadingScreen />

  // Toujours dériver du profil actif — ne pas dépendre d’un mode state qui peut être null
  const effectiveMode = profile?.active ? buildModeConfig() ?? mode : null

  return (
    <div className="min-h-screen w-full">
      <Routes>
        <Route
          path="/login"
          element={
            profile?.active ? (
              <Navigate to={profile.role === 'admin' ? '/dashboard' : '/app'} replace />
            ) : (
              <LoginPage />
            )
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute requiredRole="admin">
              {profile?.role === 'admin' ? (
                <ServerDashboardPage
                  mode={
                    effectiveMode?.mode === 'server'
                      ? effectiveMode
                      : { mode: 'server', configuredAt: new Date().toISOString() }
                  }
                  onResetMode={async () => {
                    await signOut()
                    modeKeyRef.current = ''
                    setMode(null)
                  }}
                />
              ) : (
                <Navigate to="/app" replace />
              )}
            </ProtectedRoute>
          }
        />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              {profile?.role === 'admin' ? (
                <Navigate to="/dashboard" replace />
              ) : effectiveMode?.mode === 'client' ? (
                <ClientDashboardPage
                  mode={effectiveMode}
                  onResetMode={async () => {
                    await signOut()
                    modeKeyRef.current = ''
                    setMode(null)
                  }}
                />
              ) : (
                <LoadingScreen />
              )}
            </ProtectedRoute>
          }
        />
        <Route
          path="/"
          element={
            <Navigate
              to={
                !profile?.active
                  ? '/login'
                  : profile.role === 'admin'
                    ? '/dashboard'
                    : '/app'
              }
              replace
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
