import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  LayoutGrid,
  Plus,
  RefreshCw,
  Replace,
  Swords,
  Timer,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'
import {
  applyCombatSubstitute,
  applyCombatWinner,
  assignManualOpponent,
  combatPhaseDisplay,
  combatSessionKind,
  createEmptyCombatSession,
  createTatamiId,
  distributeCombatsAcrossTatamis,
  ensureTatamiPasswords,
  hasAtLeastOneJudoka,
  isCombatSchedulableOnTatami,
  isMissingOpponent,
  listTatamisWithoutCombats,
  type CombatSession,
  type CombatStatus,
  type ManagedCombat,
  type Tatami
} from '@shared/types/combats'
import { normalizeTeamWeightClasses, resolveTeamMatches, teamMatchScore } from '@shared/utils/team-tirage'
import { normalizeTeams } from '@shared/types/teams'
import { TatamiAccessModals } from '@/components/TatamiAccessModals'

interface Props {
  onBack: () => void
  embedded?: boolean
}

function statusLabel(status: CombatStatus): string {
  switch (status) {
    case 'pending':
      return 'En attente'
    case 'ready':
      return 'Prêt'
    case 'in_progress':
      return 'En cours'
    case 'completed':
      return 'Terminé'
    default:
      return status
  }
}

function statusClass(status: CombatStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-slate-100 text-slate-600'
    case 'ready':
      return 'bg-sky-100 text-sky-800'
    case 'in_progress':
      return 'bg-amber-100 text-amber-900'
    case 'completed':
      return 'bg-emerald-100 text-emerald-800'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

function fighterLine(c: ManagedCombat, side: 'top' | 'bottom'): string {
  const f = side === 'top' ? c.top : c.bottom
  if (!f) return 'À déterminer'
  const meta = [f.club, f.age > 0 ? `${f.age} ans` : null].filter(Boolean).join(' · ')
  return meta ? `${f.name} (${meta})` : f.name
}

function CombatRow({
  c,
  session,
  confirmed,
  busy,
  assignCombat,
  setCombatStatus,
  declareWinner,
  applySubstitute,
  addManualOpponent
}: {
  c: ManagedCombat
  session: CombatSession
  confirmed: boolean
  busy: boolean
  assignCombat: (id: string, tatamiId: string | null) => void
  setCombatStatus: (id: string, status: CombatStatus) => void
  declareWinner: (id: string, winnerId: string) => void
  applySubstitute: (id: string, slot: 'top' | 'bottom') => void
  addManualOpponent: (id: string, name: string) => void
}) {
  const [manualName, setManualName] = useState('')
  const canAddManual =
    c.round === 0 && isMissingOpponent(c) && c.status !== 'completed' && c.status !== 'in_progress'
  const canPlay = c.status !== 'completed' && Boolean(c.top || c.bottom)
  return (
    <li className="rounded-lg border bg-slate-50/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-sm font-semibold">{c.label}</span>
          <span className="text-xs text-muted-foreground ml-2">{c.poolLabel}</span>
          <span className="text-xs text-muted-foreground ml-2">
            {combatPhaseDisplay(c, session) || `Tour ${c.round + 1}`}
            {c.tatamiId != null ? ` · n°${c.orderOnTatami + 1}` : ''}
          </span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(c.status)}`}>
          {statusLabel(c.status)}
          {c.bye ? ' · bye' : ''}
        </span>
      </div>
      <div className="grid gap-1 text-sm sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Blanc · </span>
          {fighterLine(c, 'top')}
          {c.winnerId && c.top?.id === c.winnerId && (
            <span className="ml-1 text-emerald-700 font-medium">✓</span>
          )}
          {c.topSubstitute && (
            <span className="block text-xs text-muted-foreground">
              Remplaçant : {c.topSubstitute.name}
            </span>
          )}
        </p>
        <p>
          <span className="text-muted-foreground">Bleu · </span>
          {fighterLine(c, 'bottom')}
          {c.winnerId && c.bottom?.id === c.winnerId && (
            <span className="ml-1 text-emerald-700 font-medium">✓</span>
          )}
          {c.bottomSubstitute && (
            <span className="block text-xs text-muted-foreground">
              Remplaçant : {c.bottomSubstitute.name}
            </span>
          )}
        </p>
      </div>
      {canAddManual && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border border-dashed bg-white px-2 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            const name = manualName.trim()
            if (!name) return
            addManualOpponent(c.id, name)
            setManualName('')
          }}
        >
          <div className="min-w-[12rem] flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">
              Adversaire manquant (tour 1) — saisie manuelle
            </Label>
            <Input
              value={manualName}
              disabled={busy}
              placeholder="Nom de l’adversaire"
              onChange={(e) => setManualName(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={busy || !manualName.trim()}>
            Ajouter
          </Button>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Label className="text-xs text-muted-foreground">Tatami</Label>
        <select
          className="flex h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={c.tatamiId ?? ''}
          disabled={busy}
          onChange={(e) => assignCombat(c.id, e.target.value ? e.target.value : null)}
        >
          <option value="">Non assigné</option>
          {session.tatamis.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {confirmed && c.status !== 'completed' && (c.topSubstitute || c.bottomSubstitute) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {c.topSubstitute && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              title={`Faire combattre ${c.topSubstitute.name}`}
              onClick={() => applySubstitute(c.id, 'top')}
            >
              <Replace className="h-3.5 w-3.5" />
              Remplaçant blanc
            </Button>
          )}
          {c.bottomSubstitute && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              title={`Faire combattre ${c.bottomSubstitute.name}`}
              onClick={() => applySubstitute(c.id, 'bottom')}
            >
              <Replace className="h-3.5 w-3.5" />
              Remplaçant bleu
            </Button>
          )}
        </div>
      )}
      {confirmed && canPlay && (
        <div className="flex flex-wrap gap-2 pt-1">
          {c.status === 'ready' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setCombatStatus(c.id, 'in_progress')}
            >
              Démarrer
            </Button>
          )}
          {(c.status === 'ready' || c.status === 'in_progress') && (
            <>
              {c.top && (
                <Button
                  size="sm"
                  variant="accent"
                  disabled={busy}
                  onClick={() => declareWinner(c.id, c.top!.id)}
                >
                  Vainqueur : {c.top.name.split(',')[0]}
                </Button>
              )}
              {c.bottom && (
                <Button
                  size="sm"
                  variant="accent"
                  disabled={busy}
                  onClick={() => declareWinner(c.id, c.bottom!.id)}
                >
                  Vainqueur : {c.bottom.name.split(',')[0]}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {confirmed && c.tatamiId && (
        <p className="text-xs text-muted-foreground">
          {session.tatamis.find((t) => t.id === c.tatamiId)?.name ?? 'Tatami'} · ordre{' '}
          {c.orderOnTatami + 1}
        </p>
      )}
    </li>
  )
}

/**
 * Combats — reprise des grilles Tirage, tatamis, confirmation et suivi d’évolution.
 */
export function CombatsPage({ onBack, embedded = false }: Props) {
  const [session, setSession] = useState<CombatSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedTatamiId, setSelectedTatamiId] = useState<string | 'unassigned' | 'all'>('all')
  const [newTatamiName, setNewTatamiName] = useState('')
  const [tatamiModalOpen, setTatamiModalOpen] = useState(false)

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const res = await window.judovac.getSettings()
      if (!res.ok) {
        setError(res.error)
        setSession(null)
        return
      }
      setSession(res.data.combatSession ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible')
      setSession(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function persist(next: CombatSession | null, okMessage?: string): Promise<boolean> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await window.judovac.setSettings({ combatSession: next })
      if (!res.ok) {
        setError(res.error)
        return false
      }
      setSession(res.data.combatSession ?? null)
      if (okMessage) setMessage(okMessage)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible')
      return false
    } finally {
      setBusy(false)
    }
  }

  const confirmed = Boolean(session?.confirmedAt)
  const stats = useMemo(() => {
    if (!session) return { total: 0, ready: 0, done: 0, unassigned: 0 }
    const visible = session.combats.filter(hasAtLeastOneJudoka)
    const schedulable = visible.filter(isCombatSchedulableOnTatami)
    return {
      total: visible.length,
      ready: visible.filter((c) => c.status === 'ready' || c.status === 'in_progress').length,
      done: visible.filter((c) => c.status === 'completed').length,
      unassigned: schedulable.filter((c) => !c.tatamiId).length
    }
  }, [session])

  const visibleCombats = useMemo(() => {
    if (!session) return []
    let list = session.combats.filter(hasAtLeastOneJudoka)
    if (selectedTatamiId === 'unassigned') {
      list = list.filter((c) => !c.tatamiId)
    } else if (selectedTatamiId !== 'all') {
      list = list.filter((c) => c.tatamiId === selectedTatamiId)
    }
    return list.sort(
      (a, b) =>
        (a.tatamiId ?? '').localeCompare(b.tatamiId ?? '') ||
        a.orderOnTatami - b.orderOnTatami ||
        a.round - b.round ||
        a.matchIndex - b.matchIndex
    )
  }, [session, selectedTatamiId])

  function addTatami(): void {
    const base = session ?? createEmptyCombatSession()
    const name =
      newTatamiName.trim() ||
      `Tatami ${base.tatamis.length + 1}`
    const tatami: Tatami = {
      id: createTatamiId(),
      name,
      createdAt: new Date().toISOString()
    }
    setNewTatamiName('')
    void persist(
      {
        ...base,
        tatamis: [...base.tatamis, tatami],
        updatedAt: new Date().toISOString()
      },
      `${tatami.name} créé — vous pouvez maintenant envoyer les combats depuis Tirage.`
    )
  }

  function removeTatami(id: string): void {
    if (!session) return
    if (confirmed) {
      setError('Impossible de supprimer un tatami après confirmation. Réimportez un tirage pour recommencer.')
      return
    }
    const next: CombatSession = {
      ...session,
      tatamis: session.tatamis.filter((t) => t.id !== id),
      combats: session.combats.map((c) =>
        c.tatamiId === id ? { ...c, tatamiId: null, orderOnTatami: 0 } : c
      ),
      updatedAt: new Date().toISOString()
    }
    if (selectedTatamiId === id) setSelectedTatamiId('all')
    void persist(next, 'Tatami supprimé')
  }

  function assignCombat(combatId: string, tatamiId: string | null): void {
    if (!session) return
    const order =
      tatamiId == null
        ? 0
        : session.combats.filter((c) => c.tatamiId === tatamiId && c.id !== combatId).length
    const next: CombatSession = {
      ...session,
      combats: session.combats.map((c) =>
        c.id === combatId
          ? {
              ...c,
              tatamiId,
              orderOnTatami: order,
              updatedAt: new Date().toISOString()
            }
          : c
      ),
      updatedAt: new Date().toISOString()
    }
    void persist(next)
  }

  function autoDistribute(): void {
    if (!session) return
    if (session.tatamis.length === 0) {
      setError('Créez au moins un tatami avant la répartition automatique.')
      return
    }
    const next = distributeCombatsAcrossTatamis(session)
    const empty = listTatamisWithoutCombats(next)
    if (empty.length > 0) {
      setError(
        `${empty.length} tatami(s) sans combat après répartition (${empty.map((t) => t.name).join(', ')}). Supprimez des tatamis ou ajoutez des combats via Tirage.`
      )
      return
    }
    void persist(next, 'Combats des tours 1 et 2 classés sur les tatamis')
  }

  async function confirmSession(): Promise<void> {
    if (!session) return
    if (!session.combats.some(hasAtLeastOneJudoka)) {
      setError('Aucun combat à confirmer. Envoyez d’abord les combats depuis Tirage.')
      return
    }
    if (session.tatamis.length === 0) {
      setError('Créez au moins un tatami avant de confirmer.')
      return
    }
    const unassigned = session.combats.filter(
      (c) => isCombatSchedulableOnTatami(c) && !c.tatamiId
    )
    if (unassigned.length > 0) {
      setError(
        `${unassigned.length} combat(s) des tours 1–2 sans tatami. Répartissez-les avant confirmation.`
      )
      return
    }
    const empty = listTatamisWithoutCombats(session)
    if (empty.length > 0) {
      setError(
        `Impossible de confirmer : tatami(s) sans combat — ${empty.map((t) => t.name).join(', ')}. Répartissez automatiquement ou assignez des combats.`
      )
      return
    }
    const now = new Date().toISOString()
    await persist(
      ensureTatamiPasswords({ ...session, confirmedAt: now, updatedAt: now }),
      'Combats confirmés et sauvegardés — le bouton Tatamis donne l’accès JVac-Chrono.'
    )
  }

  function setCombatStatus(combatId: string, status: CombatStatus): void {
    if (!session?.confirmedAt) return
    const next: CombatSession = {
      ...session,
      combats: session.combats.map((c) =>
        c.id === combatId ? { ...c, status, updatedAt: new Date().toISOString() } : c
      ),
      updatedAt: new Date().toISOString()
    }
    void persist(next)
  }

  function declareWinner(combatId: string, winnerId: string): void {
    if (!session?.confirmedAt) return
    void (async () => {
      let next = applyCombatWinner(session, combatId, winnerId)
      if (combatSessionKind(next) === 'team') {
        const settingsRes = await window.judovac.getSettings()
        const listed = await window.judovac.listJudokas({ limit: 5000, offset: 0 })
        next = resolveTeamMatches(next, {
          teams: settingsRes.ok ? normalizeTeams(settingsRes.data.teams) : [],
          judokas: listed.ok ? listed.data.items : [],
          weightClasses: settingsRes.ok
            ? normalizeTeamWeightClasses(settingsRes.data.teamWeightClasses ?? [])
            : []
        })
      }
      await persist(next, 'Vainqueur enregistré')
    })()
  }

  function addManualOpponent(combatId: string, name: string): void {
    if (!session) return
    const next = assignManualOpponent(session, combatId, name)
    void persist(next, 'Adversaire ajouté — JVac-Chrono pourra prendre ce combat en charge')
  }

  function applySubstitute(combatId: string, slot: 'top' | 'bottom'): void {
    if (!session?.confirmedAt) return
    void persist(applyCombatSubstitute(session, combatId, slot), 'Remplaçant sur le combat')
  }

  async function clearSession(): Promise<void> {
    if (!window.confirm('Effacer la session Combats actuelle ?')) return
    await persist(null, 'Session Combats effacée')
    setSelectedTatamiId('all')
  }

  return (
    <AppShell
      embedded={embedded}
      title="Combats"
      subtitle={
        combatSessionKind(session) === 'team'
          ? 'Combats par équipe : rencontres de clubs, score par catégorie, tatamis et Chrono.'
          : 'Tatamis, confirmation des grilles Tirage et suivi d’évolution des combats.'
      }
      actions={
        !embedded ? (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-6 animate-fade-in">
        {loading && <p className="text-sm text-muted-foreground">Chargement…</p>}

        {!loading && (
          <>
            {!session && (
              <div className="rounded-xl border bg-white/75 p-5 space-y-4 max-w-4xl">
                <div className="flex items-start gap-3">
                  <Swords className="h-8 w-8 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Préparez les tatamis</p>
                    <p className="text-sm text-muted-foreground">
                      Créez d’abord les tatamis ici. Ensuite, lancez le tirage et utilisez{' '}
                      <strong>Envoyer Combats</strong> sur la page Tirage pour importer les
                      combats.
                    </p>
                  </div>
                </div>
                {error && (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {error}
                  </p>
                )}
                {message && (
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    {message}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="space-y-1 flex-1 min-w-[10rem]">
                    <Label htmlFor="tatami-name-empty" className="text-xs text-muted-foreground">
                      Nom du tatami
                    </Label>
                    <Input
                      id="tatami-name-empty"
                      value={newTatamiName}
                      placeholder="Tatami 1"
                      disabled={busy}
                      onChange={(e) => setNewTatamiName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTatami()
                        }
                      }}
                    />
                  </div>
                  <Button type="button" disabled={busy} onClick={addTatami}>
                    <Plus className="h-4 w-4" />
                    Créer
                  </Button>
                </div>
              </div>
            )}

        {session && (
          <>
            <div className="rounded-xl border bg-white/75 p-5 space-y-4 max-w-4xl">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {session.combats.length > 0 && (
                      <span
                        className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          combatSessionKind(session) === 'team'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-sky-100 text-sky-800'
                        }`}
                      >
                        {combatSessionKind(session) === 'team' ? 'Par équipe' : 'Individuel'}
                      </span>
                    )}
                    {session.combats.length === 0 ? (
                      <span className="text-sky-800">Tatamis prêts — en attente des combats</span>
                    ) : confirmed ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-800">
                        <CheckCircle2 className="h-4 w-4" />
                        Session confirmée
                      </span>
                    ) : (
                      <span className="text-amber-800">Brouillon — à confirmer</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {session.combats.length === 0 ? (
                      <>
                        Créez les tatamis, puis envoyez les combats depuis le menu{' '}
                        <strong>Tirage</strong>.
                      </>
                    ) : (
                      <>
                        Tirage du{' '}
                        {new Date(session.sourceTirageAt).toLocaleString('fr-FR', {
                          dateStyle: 'short',
                          timeStyle: 'short'
                        })}
                        {session.confirmedAt && (
                          <>
                            {' '}
                            · confirmé le{' '}
                            {new Date(session.confirmedAt).toLocaleString('fr-FR', {
                              dateStyle: 'short',
                              timeStyle: 'short'
                            })}
                          </>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
                    <RefreshCw className="h-4 w-4" />
                    Actualiser
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void clearSession()}>
                    <Trash2 className="h-4 w-4" />
                    Effacer
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-4 text-sm">
                <div className="rounded-lg border bg-slate-50/80 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Combats</div>
                  <div className="font-semibold tabular-nums">{stats.total}</div>
                </div>
                <div className="rounded-lg border bg-slate-50/80 px-3 py-2">
                  <div className="text-xs text-muted-foreground">À jouer</div>
                  <div className="font-semibold tabular-nums">{stats.ready}</div>
                </div>
                <div className="rounded-lg border bg-slate-50/80 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Terminés</div>
                  <div className="font-semibold tabular-nums">{stats.done}</div>
                </div>
                <div className="rounded-lg border bg-slate-50/80 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Sans tatami (T1–T2)</div>
                  <div className="font-semibold tabular-nums">{stats.unassigned}</div>
                </div>
              </div>

              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
              {message && (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  {message}
                </p>
              )}
            </div>

            <div className="rounded-xl border bg-white/75 p-5 space-y-4 max-w-4xl">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-base">Tatamis</Label>
                {!confirmed && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || session.tatamis.length === 0}
                    onClick={autoDistribute}
                  >
                    <LayoutGrid className="h-4 w-4" />
                    Répartir automatiquement
                  </Button>
                )}
              </div>

              {!confirmed && (
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="space-y-1 flex-1 min-w-[10rem]">
                    <Label htmlFor="tatami-name" className="text-xs text-muted-foreground">
                      Nom du tatami
                    </Label>
                    <Input
                      id="tatami-name"
                      value={newTatamiName}
                      placeholder={`Tatami ${session.tatamis.length + 1}`}
                      disabled={busy}
                      onChange={(e) => setNewTatamiName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTatami()
                        }
                      }}
                    />
                  </div>
                  <Button type="button" disabled={busy} onClick={addTatami}>
                    <Plus className="h-4 w-4" />
                    Créer
                  </Button>
                </div>
              )}

              {session.tatamis.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-md border border-dashed px-3 py-4">
                  Aucun tatami. Créez-en pour séparer les combats par aire de combat.
                </p>
              ) : (
                <ul className="space-y-2">
                  {session.tatamis.map((t) => {
                    const count = session.combats.filter(
                      (c) => c.tatamiId === t.id && hasAtLeastOneJudoka(c)
                    ).length
                    return (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2 rounded-lg border bg-slate-50/80 px-3 py-2"
                      >
                        <button
                          type="button"
                          className="text-left text-sm font-medium hover:underline"
                          onClick={() => setSelectedTatamiId(t.id)}
                        >
                          {t.name}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {count} combat(s)
                          </span>
                        </button>
                        {!confirmed && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => removeTatami(t.id)}
                            aria-label={`Supprimer ${t.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {!confirmed && session.combats.some(hasAtLeastOneJudoka) && (
                <Button
                  variant="accent"
                  size="lg"
                  disabled={busy}
                  onClick={() => void confirmSession()}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirmer et sauvegarder les combats
                </Button>
              )}
              {confirmed && session.tatamis.length > 0 && (
                <Button
                  size="lg"
                  className="bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white"
                  onClick={() => setTatamiModalOpen(true)}
                >
                  <Timer className="h-4 w-4" />
                  Tatamis
                </Button>
              )}
              {!confirmed && session.combats.length === 0 && session.tatamis.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Tatamis prêts. Allez dans <strong>Tirage</strong>, générez les combats, puis
                  cliquez sur <strong>Envoyer Combats</strong>.
                </p>
              )}
            </div>

            {session.combats.some(hasAtLeastOneJudoka) && (
            <div className="rounded-xl border bg-white/75 p-5 space-y-4 max-w-4xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-base">Liste des combats</Label>
                <select
                  className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={selectedTatamiId}
                  onChange={(e) =>
                    setSelectedTatamiId(e.target.value as typeof selectedTatamiId)
                  }
                >
                  <option value="all">Tous les tatamis</option>
                  <option value="unassigned">Sans tatami</option>
                  {session.tatamis.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              {visibleCombats.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun combat pour ce filtre.</p>
              ) : combatSessionKind(session) === 'team' &&
                (session.teamMatches ?? []).some((m) =>
                  visibleCombats.some((c) => c.teamMatchId === m.id)
                ) ? (
                <div className="space-y-5">
                  {(session.teamMatches ?? [])
                    .filter((m) => visibleCombats.some((c) => c.teamMatchId === m.id))
                    .map((m) => {
                      const bouts = visibleCombats.filter((c) => c.teamMatchId === m.id)
                      const score = teamMatchScore(session, m.id)
                      return (
                        <div key={m.id} className="space-y-2">
                          <div className="rounded-lg border bg-judo-navy/95 px-3 py-2 text-white">
                            <p className="text-sm font-semibold">
                              {m.label} · {m.homeClub} vs {m.awayClub}
                            </p>
                            <p className="text-xs text-white/70">
                              Score {score.home}–{score.away}
                              {m.winnerTeamId
                                ? ` · vainqueur ${
                                    m.winnerTeamId === m.homeTeamId ? m.homeClub : m.awayClub
                                  }`
                                : ''}
                            </p>
                          </div>
                          <ul className="space-y-3">
                            {bouts.map((c) => (
                              <CombatRow
                                key={c.id}
                                c={c}
                                session={session}
                                confirmed={confirmed}
                                busy={busy}
                                assignCombat={assignCombat}
                                setCombatStatus={setCombatStatus}
                                declareWinner={declareWinner}
                                applySubstitute={applySubstitute}
                                addManualOpponent={addManualOpponent}
                              />
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                </div>
              ) : (
                <ul className="space-y-3">
                  {visibleCombats.map((c) => (
                    <CombatRow
                      key={c.id}
                      c={c}
                      session={session}
                      confirmed={confirmed}
                      busy={busy}
                      assignCombat={assignCombat}
                      setCombatStatus={setCombatStatus}
                      declareWinner={declareWinner}
                      applySubstitute={applySubstitute}
                      addManualOpponent={addManualOpponent}
                    />
                  ))}
                </ul>
              )}
            </div>
            )}
          </>
        )}
          </>
        )}
      </div>
      {tatamiModalOpen && session && (
        <TatamiAccessModals
          tatamis={session.tatamis}
          onClose={() => setTatamiModalOpen(false)}
        />
      )}
    </AppShell>
  )
}
