import { useEffect, useState } from 'react'
import { Activity, Database, FileDown, Network, Scale, Search, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ModeConfig } from '@shared/types/mode'
import type { DashboardStats, ServerStatus } from '@shared/types/dashboard'
import type { Judoka } from '@shared/types/judoka'
import { formatJudokaFullName } from '@shared/utils/judoka'
import { formatCreatorLabel } from '@shared/utils/creator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { TiragePage } from '@/pages/TiragePage'
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
  tirage: 'Tirage',
  badge: 'Designer de badge',
  pdf: 'Export PDF',
  print: 'Impression',
  backup: 'Sauvegarde',
  admin: 'Configuration'
}

async function fetchDashboard(): Promise<{
  stats: DashboardStats | null
  status: ServerStatus | null
  statsOk: boolean
  statusOk: boolean
}> {
  const [s, st] = await Promise.all([
    window.judovac.getDashboardStats(),
    window.judovac.getServerStatus()
  ])
  return {
    stats: s.ok ? s.data : null,
    status: st.ok ? st.data : null,
    statsOk: s.ok,
    statusOk: st.ok
  }
}

async function fetchAllJudokas(): Promise<Judoka[]> {
  const res = await window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
  if (!res.ok) throw new Error(res.error)
  return res.data.items
}

export function ServerDashboardPage({ onResetMode }: Props) {
  const navigate = useNavigate()
  const [view, setView] = useState<ServerNavId>('home')
  const [editing, setEditing] = useState<Judoka | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [clubsUser, setClubsUser] = useState<string | null>(null)
  const [weighedOpen, setWeighedOpen] = useState(false)
  const [judokasMenuOpen, setJudokasMenuOpen] = useState(false)
  const [unweighedOpen, setUnweighedOpen] = useState(false)
  const [unphotoOpen, setUnphotoOpen] = useState(false)
  const [focusWeight, setFocusWeight] = useState(false)
  const [ficheBusy, setFicheBusy] = useState(false)
  const [ficheMessage, setFicheMessage] = useState<string | null>(null)
  const [ficheError, setFicheError] = useState<string | null>(null)
  const [triageBusy, setTriageBusy] = useState(false)
  const [triageMessage, setTriageMessage] = useState<string | null>(null)
  const [triageError, setTriageError] = useState<string | null>(null)
  const [ownerSearchQuery, setOwnerSearchQuery] = useState('')
  const [ownerSearchLoading, setOwnerSearchLoading] = useState(false)
  const [ownerSearchResults, setOwnerSearchResults] = useState<Judoka[]>([])
  const [ownerSearchError, setOwnerSearchError] = useState<string | null>(null)
  const [ownerSearchTotal, setOwnerSearchTotal] = useState(0)

  useEffect(() => {
    let alive = true
    let consecutiveFails = 0
    let waitingFirst = true

    const tick = async () => {
      try {
        const data = await fetchDashboard()
        if (!alive) return
        if (data.statsOk && data.stats) {
          consecutiveFails = 0
          waitingFirst = false
          setStats(data.stats)
          setStatsLoading(false)
        } else {
          consecutiveFails += 1
          if (waitingFirst && consecutiveFails < 10) {
            window.setTimeout(() => {
              if (alive) void tick()
            }, 400)
          } else if (waitingFirst) {
            setStatsLoading(false)
          }
        }
        if (data.statusOk && data.status) {
          setStatus(data.status)
        }
      } catch (e) {
        console.warn('[dashboard] refresh:', e)
        consecutiveFails += 1
        if (waitingFirst && consecutiveFails < 10) {
          window.setTimeout(() => {
            if (alive) void tick()
          }, 400)
        } else if (waitingFirst) {
          setStatsLoading(false)
        }
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 2000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const q = ownerSearchQuery.trim()
    if (!q) {
      setOwnerSearchResults([])
      setOwnerSearchError(null)
      setOwnerSearchTotal(0)
      setOwnerSearchLoading(false)
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        setOwnerSearchLoading(true)
        setOwnerSearchError(null)
        const res = await window.judovac.searchJudokas(q, {}, { limit: 50, offset: 0 })
        if (cancelled) return
        setOwnerSearchLoading(false)
        if (!res.ok) {
          setOwnerSearchResults([])
          setOwnerSearchTotal(0)
          setOwnerSearchError(res.error)
          return
        }
        setOwnerSearchResults(res.data.items)
        setOwnerSearchTotal(res.data.total)
      })()
    }, 280)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [ownerSearchQuery])

  const judokaSearchActive = Boolean(ownerSearchQuery.trim())

  async function exportUserFiche(): Promise<void> {
    setFicheBusy(true)
    setFicheError(null)
    setFicheMessage(null)
    try {
      const all = await fetchAllJudokas()
      const { buildUserClubsFiches, exportAndDownloadUserClubsPdf } = await import(
        '@/lib/user-clubs-pdf'
      )
      const fiches = buildUserClubsFiches(all)
      const out = await exportAndDownloadUserClubsPdf(all, { fiches })
      setFicheMessage(`Fiche exportée (${out.userCount} utilisateur(s)) → ${out.filename}`)
    } catch (e) {
      setFicheError(e instanceof Error ? e.message : 'Export fiche utilisateurs impossible')
    } finally {
      setFicheBusy(false)
    }
  }

  async function exportWeighedTriage(): Promise<void> {
    setTriageBusy(true)
    setTriageError(null)
    setTriageMessage(null)
    try {
      const [all, settingsRes] = await Promise.all([
        fetchAllJudokas(),
        window.judovac.getSettings()
      ])
      if (!settingsRes.ok) {
        setTriageError(settingsRes.error)
        return
      }
      const weightClasses = settingsRes.data.weightClasses ?? []
      if (weightClasses.length === 0) {
        setTriageError(
          'Aucune catégorie de poids. Configurez les libellés dans Tirage (ex. -20 kg = 18 à 20) puis réessayez.'
        )
        return
      }
      const { exportAndDownloadWeighedTriagePdf } = await import('@/lib/weighed-triage-pdf')
      const out = await exportAndDownloadWeighedTriagePdf(all, weightClasses)
      setTriageMessage(`Triage exporté (${out.count} pesé(s)) → ${out.filename}`)
    } catch (e) {
      setTriageError(e instanceof Error ? e.message : 'Export triage impossible')
    } finally {
      setTriageBusy(false)
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
              value={statsLoading && !stats ? '…' : String(stats?.totalJudokas ?? 0)}
              hint={`${stats?.maleJudokas ?? 0} Garçon${(stats?.maleJudokas ?? 0) > 1 ? 's' : ''} · ${stats?.femaleJudokas ?? 0} Fille${(stats?.femaleJudokas ?? 0) > 1 ? 's' : ''}`}
              onValueClick={() => setJudokasMenuOpen(true)}
              valueTitle="Compléter poids ou photo des judokas"
            />
            <StatTile
              icon={<Scale className="h-5 w-5" />}
              label="Pesés"
              value={statsLoading && !stats ? '…' : String(stats?.weighedJudokas ?? 0)}
              hint={`${stats?.maleWeighedJudokas ?? 0} Garçon${(stats?.maleWeighedJudokas ?? 0) > 1 ? 's' : ''} · ${stats?.femaleWeighedJudokas ?? 0} Fille${(stats?.femaleWeighedJudokas ?? 0) > 1 ? 's' : ''}`}
              onValueClick={() => setWeighedOpen(true)}
              valueTitle="Voir les judokas pesés par équipe"
              action={
                <Button
                  type="button"
                  size="sm"
                  disabled={triageBusy || !(stats?.weighedJudokas)}
                  onClick={() => void exportWeighedTriage()}
                  className="h-7 shrink-0 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700 hover:text-white"
                  title="Exporter le triage PDF (club · sexe · libellé de poids)"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  {triageBusy ? '…' : 'Triage'}
                </Button>
              }
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

          {(triageError || triageMessage) && (
            <p
              className={
                triageError
                  ? 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-destructive'
                  : 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'
              }
            >
              {triageError ?? triageMessage}
            </p>
          )}

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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[10rem] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-9 pl-9"
                    placeholder="Rechercher un judoka (nom, prénom, ID…)…"
                    value={ownerSearchQuery}
                    onChange={(e) => setOwnerSearchQuery(e.target.value)}
                    aria-label="Rechercher un judoka enregistré dans le système"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={ficheBusy || !(stats?.judokaByUser?.length)}
                  onClick={() => void exportUserFiche()}
                  className="h-9 shrink-0 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white"
                  title="PDF : utilisateurs et clubs enregistrés"
                >
                  <FileDown className="h-4 w-4" />
                  {ficheBusy ? 'Export…' : 'Fiche Utilisateurs'}
                </Button>
              </div>
              {judokaSearchActive && (
                <div className="mt-3 rounded-lg border border-border/70 bg-white/90 p-3">
                  {ownerSearchLoading && (
                    <p className="text-sm text-muted-foreground">Recherche…</p>
                  )}
                  {ownerSearchError && (
                    <p className="text-sm text-destructive">{ownerSearchError}</p>
                  )}
                  {!ownerSearchLoading && !ownerSearchError && ownerSearchResults.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Aucun judoka ne correspond à « {ownerSearchQuery.trim()} ».
                    </p>
                  )}
                  {!ownerSearchLoading && ownerSearchResults.length > 0 && (
                    <>
                      <p className="mb-2 text-xs text-muted-foreground">
                        {ownerSearchTotal > ownerSearchResults.length
                          ? `${ownerSearchResults.length} judoka(s) affiché(s) sur ${ownerSearchTotal}`
                          : `${ownerSearchResults.length} judoka(s) trouvé(s)`}
                      </p>
                      <ul className="max-h-52 space-y-2 overflow-auto text-sm">
                        {ownerSearchResults.map((j) => {
                          const owner = formatCreatorLabel(j.createdBy)
                          return (
                            <li
                              key={j.id}
                              className="rounded-md border border-border/50 bg-white px-3 py-2"
                            >
                              <p className="font-medium text-judo-navy">
                                {formatJudokaFullName(j)}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Enregistré par{' '}
                                <button
                                  type="button"
                                  onClick={() => setClubsUser(owner)}
                                  className="font-semibold text-judo-navy underline-offset-2 hover:underline"
                                >
                                  {owner}
                                </button>
                                {j.displayId ? ` · ${j.displayId}` : ''}
                                {j.club ? ` · ${j.club}` : ''}
                              </p>
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  )}
                </div>
              )}
              {ficheError && <p className="mt-2 text-sm text-destructive">{ficheError}</p>}
              {ficheMessage && <p className="mt-2 text-sm text-emerald-700">{ficheMessage}</p>}
              {!judokaSearchActive && stats?.judokaByUser?.length ? (
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
              ) : !judokaSearchActive ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  {status?.dbReady
                    ? 'Aucun judoka enregistré pour l’instant.'
                    : 'Réessayez de démarrer le serveur — le stockage JSON local s’initialise automatiquement.'}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {clubsUser && (
        <UserClubsModal
          username={clubsUser}
          onClose={() => setClubsUser(null)}
          onTransferred={() => void fetchDashboard().then((data) => setStats(data.stats))}
        />
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
          autoRefreshMs={5000}
          onBack={() => setView('home')}
          onEdit={(j) => {
            setEditing(j)
            setView('form')
          }}
        />
      )}

      {view === 'tirage' && <TiragePage embedded onBack={() => setView('home')} />}
      {view === 'badge' && <BadgeDesignerPage embedded />}
      {view === 'pdf' && <PdfExportPage embedded onBack={() => setView('home')} />}
      {view === 'backup' && <BackupPage embedded onBack={() => setView('home')} />}
      {view === 'admin' && <AdminPage embedded onBack={() => setView('home')} />}
      {view === 'print' && <PrintPage embedded onBack={() => setView('home')} />}
    </WorkspaceLayout>
  )
}
