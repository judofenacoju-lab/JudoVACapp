import { useEffect, useState } from 'react'
import { Activity, Network, Users, Database } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ModeConfig } from '@shared/types/mode'
import type { DashboardStats, ServerStatus } from '@shared/types/dashboard'
import type { Judoka } from '@shared/types/judoka'
import { StatTile } from '@/components/StatTile'
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
              <h2 className="font-semibold text-judo-navy">Judokas par utilisateur</h2>
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
