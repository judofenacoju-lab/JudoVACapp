import { useEffect, useState } from 'react'
import { Activity, Network, Users, Database, RotateCcw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ModeConfig } from '@shared/types/mode'
import type { DashboardStats, ServerStatus } from '@shared/types/dashboard'
import type { Judoka } from '@shared/types/judoka'
import { StatTile } from '@/components/StatTile'
import { Button } from '@/components/ui/button'
import { WorkspaceLayout, type ServerNavId } from '@/layouts/WorkspaceLayout'
import { JudokaFormPage } from '@/pages/JudokaFormPage'
import { JudokaListPage } from '@/pages/JudokaListPage'
import { BadgeDesignerPage } from '@/pages/BadgeDesignerPage'
import { PdfExportPage } from '@/pages/PdfExportPage'
import { BackupPage } from '@/pages/BackupPage'
import { AdminPage } from '@/pages/AdminPage'
import { PrintPage } from '@/pages/PrintPage'

interface Props {
  mode: ModeConfig
  onResetMode: () => Promise<void>
}

const TITLES: Record<ServerNavId, string> = {
  home: 'Tableau de bord',
  form: 'Judoka',
  list: 'Liste / Recherche',
  badge: 'Designer de badge',
  pdf: 'Export PDF',
  print: 'Impression',
  backup: 'Sauvegarde',
  admin: 'Configuration'
}

type ResetScope = 'all' | 'server' | 'client'

async function fetchDashboard(): Promise<{
  stats: DashboardStats | null
  status: ServerStatus | null
}> {
  const [s, st] = await Promise.all([
    window.judovac.getDashboardStats(),
    window.judovac.getServerStatus()
  ])
  return {
    stats: s.ok ? s.data : null,
    status: st.ok ? st.data : null
  }
}

export function ServerDashboardPage({ onResetMode }: Props) {
  const navigate = useNavigate()
  const [view, setView] = useState<ServerNavId>('home')
  const [editing, setEditing] = useState<Judoka | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetScope, setResetScope] = useState<ResetScope>('all')
  const [resetClient, setResetClient] = useState('')
  const [clientOptions, setClientOptions] = useState<string[]>([])
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  async function refreshDashboard(): Promise<void> {
    const data = await fetchDashboard()
    setStats(data.stats)
    setStatus(data.status)
  }

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const data = await fetchDashboard()
      if (!alive) return
      setStats(data.stats)
      setStatus(data.status)
    }
    void tick()
    const id = setInterval(() => void tick(), 1000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  async function openResetModal(): Promise<void> {
    setResetError(null)
    setResetScope('all')
    setResetClient('')
    const [creatorsRes, usersRes] = await Promise.all([
      window.judovac.listJudokaCreators(),
      window.judovac.listUsers()
    ])
    const names = new Set<string>()
    if (creatorsRes.ok) {
      for (const name of creatorsRes.data.items) {
        if (name !== 'Serveur') names.add(name)
      }
    }
    if (usersRes.ok) {
      for (const u of usersRes.data.items) names.add(u.username)
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'fr'))
    setClientOptions(sorted)
    if (sorted[0]) setResetClient(sorted[0])
    setResetOpen(true)
  }

  async function confirmReset(): Promise<void> {
    if (resetScope === 'client' && !resetClient.trim()) {
      setResetError('Sélectionnez un compte client.')
      return
    }
    setResetBusy(true)
    setResetError(null)
    try {
      const res = await window.judovac.resetJudokas({
        scope: resetScope,
        username: resetScope === 'client' ? resetClient.trim() : undefined
      })
      if (!res.ok) {
        setResetError(res.error || 'Échec de la réinitialisation')
        return
      }
      const deleted = res.data?.deleted ?? 0
      setResetOpen(false)
      await refreshDashboard()
      // Feedback visible sur le dashboard via un petit délai de refresh
      window.setTimeout(() => void refreshDashboard(), 300)
      if (deleted === 0) {
        console.info('[JudoVACapp] Réinitialisation OK — aucun judoka à effacer')
      }
    } catch (err) {
      setResetError(err instanceof Error ? err.message : String(err))
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <WorkspaceLayout
      role="server"
      active={view === 'form' && editing ? 'list' : view}
      title={
        view === 'form'
          ? editing
            ? `Modifier ${editing.displayId}`
            : 'Nouveau judoka'
          : TITLES[view]
      }
      subtitle={view === 'home' ? 'Dashboard du Serveur' : undefined}
      onNavigate={(id) => {
        setEditing(null)
        setView(id as ServerNavId)
      }}
      onLogout={async () => {
        await onResetMode()
        navigate('/')
      }}
    >
      {view === 'home' && (
        <div className="space-y-8 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              icon={<Users className="h-5 w-5" />}
              label="Judokas"
              value={String(stats?.totalJudokas ?? 0)}
            />
            <StatTile
              icon={<Network className="h-5 w-5" />}
              label="Clients connectés"
              value={String(stats?.connectedClients ?? status?.connectedClients.length ?? 0)}
            />
            <StatTile
              icon={<Activity className="h-5 w-5" />}
              label="Réseau"
              value={stats?.networkStatus === 'online' ? 'En ligne' : 'Hors ligne'}
              tone={stats?.networkStatus === 'online' ? 'ok' : 'warn'}
            />
            <StatTile
              icon={<Database className="h-5 w-5" />}
              label="Stockage"
              value={status?.dbReady ? 'Cloud' : 'Indisponible'}
              tone={status?.dbReady ? 'ok' : 'muted'}
            />
          </div>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border bg-white/70 p-5">
              <h2 className="font-semibold text-judo-navy">État serveur</h2>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Hébergement</dt>
                  <dd className="font-mono text-right">Cloud</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Adresse</dt>
                  <dd className="font-mono text-right">
                    {status?.preferredAddress ?? '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Port</dt>
                  <dd className="font-mono">{status?.port ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Démarré</dt>
                  <dd>
                    {status?.startedAt
                      ? new Date(status.startedAt).toLocaleString('fr-FR')
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Écoute</dt>
                  <dd>{status?.running ? 'Active' : 'Arrêtée'}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border bg-white/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-judo-navy">Judokas par utilisateur</h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!status?.dbReady}
                  onClick={() => void openResetModal()}
                >
                  <RotateCcw className="h-4 w-4" />
                  Réinitialiser
                </Button>
              </div>
              {stats?.judokaByUser?.length ? (
                <ul className="mt-4 max-h-64 space-y-2 overflow-auto text-sm">
                  {stats.judokaByUser.map((entry) => (
                    <li
                      key={entry.username}
                      className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0"
                    >
                      <span className="font-medium text-judo-navy">{entry.username}</span>
                      <span className="rounded-full bg-judo-red/10 px-2.5 py-0.5 font-mono text-sm font-semibold text-judo-red">
                        {entry.count}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  {status?.dbReady
                    ? 'Aucun judoka enregistré pour l’instant.'
                    : 'Réessayez de démarrer le serveur — le stockage JSON local s’initialise automatiquement.'}
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {resetOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          onClick={() => {
            if (!resetBusy) setResetOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-judokas-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="reset-judokas-title" className="text-lg font-semibold text-judo-navy">
              Réinitialiser les judokas
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Cette action efface définitivement les enregistrements sélectionnés. Les comptes
              utilisateurs ne sont pas supprimés.
            </p>

            <div className="mt-4 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-destructive/30 p-3 hover:bg-destructive/5">
                <input
                  type="radio"
                  name="reset-scope"
                  className="mt-1"
                  checked={resetScope === 'all'}
                  onChange={() => setResetScope('all')}
                />
                <span className="text-sm">
                  <span className="font-medium text-destructive">Tout</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Efface tous les judokas du système (Serveur et tous les clients).
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
                <input
                  type="radio"
                  name="reset-scope"
                  className="mt-1"
                  checked={resetScope === 'server'}
                  onChange={() => setResetScope('server')}
                />
                <span className="text-sm">
                  <span className="font-medium text-judo-navy">Serveur</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Efface uniquement les judokas enregistrés par le compte Serveur.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
                <input
                  type="radio"
                  name="reset-scope"
                  className="mt-1"
                  checked={resetScope === 'client'}
                  onChange={() => setResetScope('client')}
                />
                <span className="text-sm">
                  <span className="font-medium text-judo-navy">Client</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Choisir un client pour effacer ses judokas uniquement.
                  </span>
                </span>
              </label>
            </div>

            {resetScope === 'client' && (
              <div className="mt-4 space-y-2">
                <label htmlFor="reset-client" className="text-sm font-medium text-judo-navy">
                  Compte client
                </label>
                {clientOptions.length > 0 ? (
                  <select
                    id="reset-client"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={resetClient}
                    onChange={(e) => setResetClient(e.target.value)}
                  >
                    {clientOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-muted-foreground">Aucun compte client disponible.</p>
                )}
              </div>
            )}

            {resetError && <p className="mt-3 text-sm text-destructive">{resetError}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={resetBusy}
                onClick={() => setResetOpen(false)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={resetBusy || (resetScope === 'client' && !resetClient.trim())}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void confirmReset()
                }}
              >
                {resetBusy ? 'Réinitialisation…' : 'Confirmer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {view === 'form' && (
        <JudokaFormPage
          embedded
          createdBy="serveur"
          createdWorkstation="local"
          editing={editing}
          onBack={() => {
            setEditing(null)
            setView(editing ? 'list' : 'home')
          }}
          onSaved={() => {
            setEditing(null)
            setView('list')
          }}
        />
      )}

      {view === 'list' && (
        <JudokaListPage
          embedded
          autoRefreshMs={1000}
          onBack={() => setView('home')}
          onEdit={(j) => {
            setEditing(j)
            setView('form')
          }}
        />
      )}

      {view === 'badge' && <BadgeDesignerPage embedded />}
      {view === 'pdf' && <PdfExportPage embedded onBack={() => setView('home')} />}
      {view === 'backup' && <BackupPage embedded onBack={() => setView('home')} />}
      {view === 'admin' && <AdminPage embedded onBack={() => setView('home')} />}
      {view === 'print' && <PrintPage embedded onBack={() => setView('home')} />}
    </WorkspaceLayout>
  )
}
