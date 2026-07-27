import { useEffect, useState } from 'react'
import { Activity, Database, FileDown, Network, Scale, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ModeConfig } from '@shared/types/mode'
import type { DashboardStats, ServerStatus } from '@shared/types/dashboard'
import type { Judoka } from '@shared/types/judoka'
import { Button } from '@/components/ui/button'
import { StatTile } from '@/components/StatTile'
import { UserClubsModal } from '@/components/UserClubsModal'
import { WeighedJudokasModal } from '@/components/WeighedJudokasModal'
import { RegisteredJudokasMenuModal } from '@/components/RegisteredJudokasMenuModal'
import { UnweighedJudokasModal } from '@/components/UnweighedJudokasModal'
import { UnphotographedJudokasModal } from '@/components/UnphotographedJudokasModal'
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
  const [clubsUser, setClubsUser] = useState<string | null>(null)
  const [weighedOpen, setWeighedOpen] = useState(false)
  const [judokasMenuOpen, setJudokasMenuOpen] = useState(false)
  const [unweighedOpen, setUnweighedOpen] = useState(false)
  const [unphotoOpen, setUnphotoOpen] = useState(false)
  const [focusWeight, setFocusWeight] = useState(false)
  const [ficheBusy, setFicheBusy] = useState(false)
  const [ficheMessage, setFicheMessage] = useState<string | null>(null)
  const [ficheError, setFicheError] = useState<string | null>(null)

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

  async function exportUserFiche(): Promise<void> {
    setFicheBusy(true)
    setFicheError(null)
    setFicheMessage(null)
    try {
      const res = await window.judovac.listJudokas({ limit: 50_000, offset: 0 })
      if (!res.ok) {
        setFicheError(res.error)
        return
      }
      const { exportAndDownloadUserClubsPdf } = await import('@/lib/user-clubs-pdf')
      const out = await exportAndDownloadUserClubsPdf(res.data.items)
      setFicheMessage(`Fiche exportée (${out.userCount} utilisateur(s)) → ${out.filename}`)
    } catch (e) {
      setFicheError(e instanceof Error ? e.message : 'Export fiche utilisateurs impossible')
    } finally {
      setFicheBusy(false)
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
        setFocusWeight(false)
        setView(id as ServerNavId)
      }}
      onLogout={async () => {
        await onResetMode()
        navigate('/')
      }}
    >
      {view === 'home' && (
        <div className="space-y-8 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatTile
              icon={<Users className="h-5 w-5" />}
              label="Judokas"
              value={String(stats?.totalJudokas ?? 0)}
              hint={`${stats?.maleJudokas ?? 0} Garçon${(stats?.maleJudokas ?? 0) > 1 ? 's' : ''} · ${stats?.femaleJudokas ?? 0} Fille${(stats?.femaleJudokas ?? 0) > 1 ? 's' : ''}`}
              onValueClick={() => setJudokasMenuOpen(true)}
              valueTitle="Compléter poids ou photo des judokas"
            />
            <StatTile
              icon={<Scale className="h-5 w-5" />}
              label="Pesés"
              value={String(stats?.weighedJudokas ?? 0)}
              hint={`${stats?.maleWeighedJudokas ?? 0} Garçon${(stats?.maleWeighedJudokas ?? 0) > 1 ? 's' : ''} · ${stats?.femaleWeighedJudokas ?? 0} Fille${(stats?.femaleWeighedJudokas ?? 0) > 1 ? 's' : ''}`}
              onValueClick={() => setWeighedOpen(true)}
              valueTitle="Voir les judokas pesés par équipe"
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold text-judo-navy">Judokas par utilisateur</h2>
                <Button
                  type="button"
                  size="sm"
                  disabled={ficheBusy || !(stats?.judokaByUser?.length)}
                  onClick={() => void exportUserFiche()}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white"
                >
                  <FileDown className="h-4 w-4" />
                  {ficheBusy ? 'Export…' : 'Fiche Utilisateurs'}
                </Button>
              </div>
              {ficheError && <p className="mt-2 text-sm text-destructive">{ficheError}</p>}
              {ficheMessage && <p className="mt-2 text-sm text-emerald-700">{ficheMessage}</p>}
              {stats?.judokaByUser?.length ? (
                <ul className="mt-4 max-h-64 space-y-2 overflow-auto text-sm">
                  {stats.judokaByUser.map((entry) => (
                    <li
                      key={entry.username}
                      className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0"
                    >
                      <button
                        type="button"
                        onClick={() => setClubsUser(entry.username)}
                        className="bg-transparent text-left font-medium text-judo-navy underline-offset-2 hover:underline"
                        title="Voir les clubs enregistrés"
                      >
                        {entry.username}
                      </button>
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

      {clubsUser && (
        <UserClubsModal username={clubsUser} onClose={() => setClubsUser(null)} />
      )}

      {weighedOpen && <WeighedJudokasModal onClose={() => setWeighedOpen(false)} />}

      {judokasMenuOpen && (
        <RegisteredJudokasMenuModal
          onClose={() => setJudokasMenuOpen(false)}
          onOpenUnweighed={() => {
            setJudokasMenuOpen(false)
            setUnweighedOpen(true)
          }}
          onOpenUnphotographed={() => {
            setJudokasMenuOpen(false)
            setUnphotoOpen(true)
          }}
        />
      )}

      {unweighedOpen && (
        <UnweighedJudokasModal
          onClose={() => setUnweighedOpen(false)}
          onOpenForm={(j) => {
            setUnweighedOpen(false)
            setEditing(j)
            setFocusWeight(true)
            setView('form')
          }}
        />
      )}

      {unphotoOpen && (
        <UnphotographedJudokasModal onClose={() => setUnphotoOpen(false)} />
      )}

      {view === 'form' && (
        <JudokaFormPage
          embedded
          createdBy="serveur"
          createdWorkstation="local"
          editing={editing}
          focusWeight={focusWeight}
          onBack={() => {
            setEditing(null)
            setFocusWeight(false)
            setView(editing ? 'list' : 'home')
          }}
          onSaved={() => {
            setEditing(null)
            setFocusWeight(false)
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
