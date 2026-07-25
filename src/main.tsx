import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { installRandomUuidPolyfill } from '@/lib/create-id'
import { installJudovacClient } from '@/lib/judovac-client'
import { AuthProvider } from '@/lib/auth-context'
import App from './App'
import './index.css'

installRandomUuidPolyfill()

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[JudoVACapp]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            background: '#0B1F3A',
            color: '#fff'
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Erreur d’affichage</h1>
          <p style={{ marginBottom: 12, opacity: 0.8 }}>
            Rechargez la page. Si le problème continue, videz le cache du navigateur.
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              background: 'rgba(255,255,255,0.1)',
              padding: 12,
              borderRadius: 8
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            style={{
              marginTop: 16,
              background: '#C8102E',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '10px 16px',
              fontWeight: 600
            }}
            onClick={() => window.location.reload()}
          >
            Recharger
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const rootEl = document.getElementById('root')

try {
  installJudovacClient()
  if (!rootEl) throw new Error('Élément #root introuvable')

  // Pas de StrictMode en prod web — double-mount aggrave les races auth sur tablette
  ReactDOM.createRoot(rootEl).render(
    <RootErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  )
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  if (rootEl) {
    rootEl.innerHTML = `<div style="min-height:100vh;padding:24px;font-family:system-ui,sans-serif;background:#0B1F3A;color:#fff">
      <h1>Impossible de démarrer JudoVACapp</h1>
      <p>${msg}</p>
      <button onclick="location.reload()" style="margin-top:16px;background:#C8102E;color:#fff;border:0;border-radius:8px;padding:10px 16px">Recharger</button>
    </div>`
  }
}
