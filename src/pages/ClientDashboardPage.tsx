import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, UserRound, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ModeConfig } from '@shared/types/mode'
import type { ClientConnectionStatus, DashboardStats } from '@shared/types/dashboard'
import type { Judoka } from '@shared/types/judoka'
import { Button } from '@/components/ui/button'
import { StatTile } from '@/components/StatTile'
import { WorkspaceLayout, type ClientNavId } from '@/layouts/WorkspaceLayout'
import { JudokaFormPage } from '@/pages/JudokaFormPage'
import { JudokaListPage } from '@/pages/JudokaListPage'

interface Props {
  mode: ModeConfig
  onResetMode: () => Promise<void>
}

export function ClientDashboardPage({ mode, onResetMode }: Props) {
  const navigate = useNavigate()
  const [view, setView] = useState<ClientNavId>('home')
  const [editing, setEditing] = useState<Judoka | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [status, setStatus] = useState<ClientConnectionStatus | null>(null)
  const [registeredCount, setRegisteredCount] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [flushBusy, setFlushBusy] = useState(false)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)

  const clientName = mode.username?.trim() || 'Client'

  const refreshRegistered = useCallback(async (): Promise<void> => {
    setRefreshBusy(true)
    try {
      const [s, st, reg] = await Promise.all([
        window.judovac.getDashboardStats(),
        window.judovac.getClientStatus(),
        window.judovac.getRegisteredCount()
      ])
      if (s.ok) setStats(s.data)
      if (st.ok) setStatus(st.data)
      if (reg.ok) {
        setRegisteredCount(reg.data.count)
        setStatus((prev) =>
          prev ? { ...prev, queueSize: reg.data.queueSize } : prev
        )
      }
    } finally {
      setRefreshBusy(false)
    }
  }, [])

  /** Vide la file locale (tous utilisateurs) sur cet ordinateur. */
  async function clearLocalPending(): Promise<void> {
    const pending = status?.queueSize ?? 0
    const ok = window.confirm(
      pending > 0
        ? `Effacer définitivement ${pending} enregistrement(s) en attente stocké(s) localement sur cet ordinateur ?\n\nCes fichiers ne seront plus envoyés au serveur (tous utilisateurs confondus).`
        : 'Scanner et vider le stockage local des judokas en attente sur cet ordinateur ?'
    )
    if (!ok) return

    setClearBusy(true)
    setMessage(null)
    try {
      const res = await window.judovac.clearLocalSyncQueue()
      if (!res.ok) {
        setMessage(`Échec du nettoyage local : ${res.error}`)
        return
      }
      setStatus((prev) => (prev ? { ...prev, queueSize: 0, lastError: null } : prev))
      await refreshRegistered()
      setMessage(
        res.data.cleared > 0
          ? `Stockage local vidé — ${res.data.cleared} enregistrement(s) en attente supprimé(s).`
          : 'Stockage local déjà vide — aucun fichier en attente.'
      )
    } finally {
      setClearBusy(false)
    }
  }

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const [s, st, reg] = await Promise.all([
        window.judovac.getDashboardStats(),
        window.judovac.getClientStatus(),
        window.judovac.getRegisteredCount()
      ])
      if (!alive) return
      if (s.ok) setStats(s.data)
      if (st.ok) setStatus(st.data)
      if (reg.ok) setRegisteredCount(reg.data.count)
    }
    void tick()
    const id = setInterval(() => void tick(), 2500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [view])

  async function flush(): Promise<void> {
    setFlushBusy(true)
    setMessage(null)
    try {
      const res = await window.judovac.flushSync()
      if (!res.ok) {
        setMessage(`Échec sync: ${res.error}`)
        return
      }
      setStatus(res.data)
      const sent = res.data.lastFlushSent ?? 0
      const remaining = res.data.queueSize
      await refreshRegistered()

      if (!res.data.connected) {
        setMessage(
          `Serveur injoignable${res.data.lastError ? ` (${res.data.lastError})` : ''}. ` +
            `${remaining} élément(s) conservé(s) en local sur cet ordinateur — réessayez plus tard.`
        )
        return
      }
      if (remaining > 0) {
        setMessage(
          `Sync partielle : ${sent} envoyé(s), ${remaining} restant(s) en attente` +
            `${res.data.lastError ? ` — ${res.data.lastError}` : ''}.`
        )
        return
      }
      setMessage(
        sent > 0
          ? `Synchronisation réussie — ${sent} élément(s) transmis au serveur.`
          : 'Aucun fichier en attente — tout est déjà synchronisé.'
      )
    } finally {
      setFlushBusy(false)
    }
  }

  const pageTitle =
    view === 'form'
      ? editing
        ? `Modifier ${editing.displayId}`
        : 'Nouveau judoka'
      : view === 'home'
        ? clientName
        : view === 'list'
          ? 'Liste / Recherche'
          : 'Synchronisation'

  return (
    <WorkspaceLayout
      role="client"
      active={view === 'form' && editing ? 'list' : view}
      title={pageTitle}
      subtitle={`${mode.workstation ?? ''} → ${mode.serverHost ?? ''}`}
      onNavigate={(id) => {
        setEditing(null)
        if (id === 'sync') {
          setView('sync')
          void flush()
          return
        }
        setView(id as ClientNavId)
      }}
      onLogout={async () => {
        await onResetMode()
        navigate('/')
      }}
    >
      {view === 'home' && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              icon={<UserRound className="h-5 w-5" />}
              label="État serveur"
              value={status?.connected ? 'Connecté' : 'Hors ligne'}
              tone={status?.connected ? 'ok' : 'warn'}
            />
            <StatTile
              icon={<RefreshCw className="h-5 w-5" />}
              label="Enregistrés"
              value={String(registeredCount)}
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  title="Actualiser le nombre d'enregistrés"
                  disabled={refreshBusy}
                  onClick={() => void refreshRegistered()}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshBusy ? 'animate-spin' : ''}`} />
                </Button>
              }
            />
            <StatTile
              icon={<Plus className="h-5 w-5" />}
              label="Réseau"
              value={stats?.networkStatus === 'online' ? 'OK' : 'Hors ligne'}
              tone={stats?.networkStatus === 'online' ? 'ok' : 'warn'}
            />
          </div>

          {(status?.queueSize ?? 0) > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {status?.queueSize} fichier(s) en attente de synchronisation — utilisez « Forcer la
              synchronisation ».
            </p>
          )}

          {message && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {message}
            </p>
          )}
        </div>
      )}

      {view === 'form' && (
        <JudokaFormPage
          embedded
          createdBy={mode.username ?? 'client'}
          createdWorkstation={mode.workstation ?? 'poste'}
          editing={editing}
          onBack={() => {
            setEditing(null)
            setView(editing ? 'list' : 'home')
          }}
          onSaved={(result) => {
            if (result?.synced) {
              setMessage(
                editing
                  ? 'Modification synchronisée avec le serveur.'
                  : 'Judoka enregistré et synchronisé avec le serveur.'
              )
            } else {
              setMessage(
                `Enregistré en local (${result?.queueSize ?? 1} en attente). ` +
                  'Envoi automatique dès que le serveur est joignable — ou utilisez « Forcer la synchronisation ».'
              )
            }
            setEditing(null)
            setView('list')
            void refreshRegistered()
          }}
        />
      )}

      {view === 'list' && (
        <JudokaListPage
          embedded
          clientMode
          clientUsername={mode.username ?? 'client'}
          onBack={() => setView('home')}
          onEdit={(j) => {
            setEditing(j)
            setView('form')
          }}
        />
      )}

      {view === 'sync' && (
        <div className="max-w-lg space-y-4 animate-fade-in rounded-xl border bg-white/75 p-6">
          <p className="text-sm text-muted-foreground">
            Enregistrés : <strong>{registeredCount}</strong>
          </p>
          <p className="text-sm text-muted-foreground">
            En attente d’envoi : <strong>{status?.queueSize ?? 0}</strong> fichier(s)
          </p>
          <p className="text-sm">
            Serveur :{' '}
            <strong className={status?.connected ? 'text-emerald-700' : 'text-amber-700'}>
              {status?.connected ? 'Connecté' : 'Déconnecté / hors ligne'}
            </strong>
          </p>
          {status?.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Dernière sync : {new Date(status.lastSyncAt).toLocaleString('fr-FR')}
            </p>
          )}
          {status?.lastError && (status.queueSize ?? 0) > 0 && (
            <p className="text-sm text-amber-800">Dernière erreur : {status.lastError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            « Actualiser » scanne et vide le dossier local des judokas en attente sur cet
            ordinateur (tous utilisateurs). « Forcer la synchronisation » envoie la file vers le
            serveur.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={clearBusy || flushBusy}
              onClick={() => void clearLocalPending()}
            >
              <RefreshCw className={`h-4 w-4 ${clearBusy ? 'animate-spin' : ''}`} />
              {clearBusy ? 'Nettoyage…' : 'Actualiser'}
            </Button>
            <Button variant="accent" disabled={flushBusy || clearBusy} onClick={() => void flush()}>
              <RefreshCw className={`h-4 w-4 ${flushBusy ? 'animate-spin' : ''}`} />
              {flushBusy ? 'Synchronisation…' : 'Forcer la synchronisation'}
            </Button>
          </div>
          {message && <p className="text-sm text-emerald-700">{message}</p>}
        </div>
      )}
    </WorkspaceLayout>
  )
}
