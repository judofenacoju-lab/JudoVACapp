import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, FolderOpen, Pencil, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-react'
import type { Judoka } from '@shared/types/judoka'
import type { TeamWeightClassRange } from '@shared/types/settings'
import {
  createTeamId,
  normalizeTeams,
  teamDisplayName,
  upsertTeamLineup,
  type Team
} from '@shared/types/teams'
import { formatJudokaFullName } from '@shared/utils/judoka'
import { mergeRegisteredClubNames } from '@shared/utils/clubs'
import { normalizeTeamWeightClasses } from '@shared/utils/team-tirage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'
import { JudokaFormPage } from '@/pages/JudokaFormPage'

interface Props {
  createdBy: string
  createdWorkstation?: string
  onBack: () => void
  embedded?: boolean
}

function judokaWeight(j: Judoka): number {
  const n = Number(j.weightKg)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function inWeightClass(j: Judoka, wc: TeamWeightClassRange): boolean {
  if (j.sex !== wc.sex) return false
  const w = judokaWeight(j)
  if (w <= 0) return false
  return w >= wc.minKg - 1e-9 && w <= wc.maxKg + 1e-9
}

/**
 * Enregistrement d’une équipe : valider un club, puis y importer ou créer des judokas.
 */
export function TeamFormPage({
  createdBy,
  createdWorkstation = 'poste',
  onBack,
  embedded = false
}: Props) {
  const [teams, setTeams] = useState<Team[]>([])
  const [clubs, setClubs] = useState<string[]>([])
  const [judokas, setJudokas] = useState<Judoka[]>([])
  const [weightClasses, setWeightClasses] = useState<TeamWeightClassRange[]>([])
  const [clubMode, setClubMode] = useState<'existing' | 'new'>('existing')
  const [club, setClub] = useState('')
  const [newClub, setNewClub] = useState('')
  const [name, setName] = useState('')
  const [activeTeam, setActiveTeam] = useState<Team | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Judoka[]>([])
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingJudoka, setEditingJudoka] = useState<Judoka | null>(null)

  async function reload(teamId?: string): Promise<void> {
    const [settingsRes, listed] = await Promise.all([
      window.judovac.getSettings(),
      window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
    ])
    if (settingsRes.ok) {
      const nextTeams = normalizeTeams(settingsRes.data.teams)
      setTeams(nextTeams)
      setWeightClasses(normalizeTeamWeightClasses(settingsRes.data.teamWeightClasses ?? []))
      const fromJudokas = listed.ok
        ? listed.data.items.map((j) => j.club).filter(Boolean)
        : []
      setClubs(mergeRegisteredClubNames([...(settingsRes.data.clubs ?? []), ...fromJudokas]))
      const id = teamId ?? activeTeam?.id
      if (id) {
        setActiveTeam(nextTeams.find((t) => t.id === id) ?? null)
      }
    }
    if (listed.ok) setJudokas(listed.data.items)
  }

  useEffect(() => {
    void reload().catch((e) => {
      setError(e instanceof Error ? e.message : 'Chargement impossible')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargement initial
  }, [])

  const chosenClub = (clubMode === 'new' ? newClub : club).trim()

  const members = useMemo(() => {
    if (!activeTeam) return []
    const ids = new Set(activeTeam.judokaIds)
    return judokas
      .filter((j) => ids.has(j.id))
      .sort((a, b) => formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr'))
  }, [judokas, activeTeam])

  const classified = useMemo(() => {
    const used = new Set<string>()
    const blocks = weightClasses.map((wc) => {
      const items = members.filter((j) => inWeightClass(j, wc))
      for (const j of items) used.add(j.id)
      return { wc, items }
    })
    const uncategorized = members.filter((j) => !used.has(j.id))
    return { blocks, uncategorized }
  }, [members, weightClasses])

  function resetClubForm(): void {
    setClub('')
    setNewClub('')
    setName('')
    setClubMode('existing')
    setActiveTeam(null)
    setModalOpen(false)
    setHits([])
    setQuery('')
    setCreating(false)
    setEditingJudoka(null)
  }

  function openTeam(team: Team): void {
    setActiveTeam(team)
    setClubMode('existing')
    setClub(team.club)
    setNewClub('')
    setName(team.name === team.club ? '' : team.name)
    setError(null)
    setMessage(null)
    setHits([])
    setQuery('')
    setCreating(false)
    setEditingJudoka(null)
    setModalOpen(true)
    void reload(team.id)
  }

  async function persistTeam(nextTeam: Team, extraClubs: string[] = []): Promise<Team | null> {
    const settingsRes = await window.judovac.getSettings()
    if (!settingsRes.ok) {
      setError(settingsRes.error)
      return null
    }
    const current = normalizeTeams(settingsRes.data.teams)
    const others = current.filter(
      (t) =>
        t.id !== nextTeam.id && t.club.trim().toLowerCase() !== nextTeam.club.trim().toLowerCase()
    )
    const clubsNext = mergeRegisteredClubNames(
      [...(settingsRes.data.clubs ?? []), nextTeam.club, ...extraClubs]
    )
    const saved = await window.judovac.setSettings({
      teams: normalizeTeams([...others, nextTeam]),
      clubs: clubsNext
    })
    if (!saved.ok) {
      setError(saved.error)
      return null
    }
    const stored = normalizeTeams(saved.data.teams)
    setTeams(stored)
    setClubs(mergeRegisteredClubNames([...(saved.data.clubs ?? []), ...judokas.map((j) => j.club)]))
    return stored.find((t) => t.id === nextTeam.id) ?? nextTeam
  }

  async function validateClub(): Promise<void> {
    if (!chosenClub) {
      setError(
        clubMode === 'new'
          ? 'Saisissez le nom du nouveau club.'
          : 'Sélectionnez un club existant.'
      )
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const now = new Date().toISOString()
      const settingsRes = await window.judovac.getSettings()
      if (!settingsRes.ok) {
        setError(settingsRes.error)
        return
      }
      const current = normalizeTeams(settingsRes.data.teams)
      const existing = current.find((t) => t.club.trim().toLowerCase() === chosenClub.toLowerCase())
      const alreadyInClub = judokas
        .filter((j) => (j.club ?? '').trim().toLowerCase() === chosenClub.toLowerCase())
        .map((j) => j.id)
      const nextTeam: Team = {
        id: existing?.id ?? createTeamId(),
        club: existing?.club ?? chosenClub,
        name: name.trim() || existing?.name || chosenClub,
        judokaIds: [...new Set([...(existing?.judokaIds ?? []), ...alreadyInClub])],
        lineups: existing?.lineups ?? [],
        createdBy: existing?.createdBy || createdBy,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      const saved = await persistTeam(nextTeam)
      if (!saved) return
      setActiveTeam(saved)
      setClub(saved.club)
      setClubMode('existing')
      setNewClub('')
      setModalOpen(true)
      setMessage(
        `Club « ${teamDisplayName(saved)} » validé comme équipe${
          saved.judokaIds.length ? ` (${saved.judokaIds.length} judoka(s) du club)` : ''
        }.`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation impossible')
    } finally {
      setBusy(false)
    }
  }

  async function addMember(judoka: Judoka): Promise<void> {
    if (!activeTeam) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const sameClub =
        (judoka.club ?? '').trim().toLowerCase() === activeTeam.club.trim().toLowerCase()
      if (!sameClub) {
        const up = await window.judovac.updateJudoka(judoka.id, {
          ...judoka,
          club: activeTeam.club
        })
        if (!up.ok) {
          setError(up.error)
          return
        }
      }
      const nextTeam: Team = {
        ...activeTeam,
        judokaIds: [...new Set([...activeTeam.judokaIds, judoka.id])],
        updatedAt: new Date().toISOString()
      }
      const saved = await persistTeam(nextTeam)
      if (!saved) return
      setActiveTeam(saved)
      setJudokas((prev) =>
        prev.map((j) => (j.id === judoka.id ? { ...j, club: activeTeam.club } : j))
      )
      setHits((prev) => prev.filter((j) => j.id !== judoka.id))
      setMessage(`${formatJudokaFullName(judoka)} importé dans ${teamDisplayName(saved)}.`)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import impossible')
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(judokaId: string): Promise<void> {
    if (!activeTeam) return
    setBusy(true)
    setError(null)
    try {
      const nextTeam: Team = {
        ...activeTeam,
        judokaIds: activeTeam.judokaIds.filter((id) => id !== judokaId),
        lineups: (activeTeam.lineups ?? []).map((l) => ({
          ...l,
          principalId: l.principalId === judokaId ? null : l.principalId,
          substituteId: l.substituteId === judokaId ? null : l.substituteId
        })),
        updatedAt: new Date().toISOString()
      }
      const saved = await persistTeam(nextTeam)
      if (!saved) return
      setActiveTeam(saved)
    } finally {
      setBusy(false)
    }
  }

  async function saveLineup(
    wc: TeamWeightClassRange,
    patch: { principalId?: string | null; substituteId?: string | null }
  ): Promise<void> {
    if (!activeTeam) return
    setBusy(true)
    setError(null)
    try {
      const saved = await persistTeam(upsertTeamLineup(activeTeam, wc, patch))
      if (!saved) return
      setActiveTeam(saved)
    } finally {
      setBusy(false)
    }
  }

  async function search(): Promise<void> {
    const q = query.trim()
    if (q.length < 2) {
      setError('Saisissez au moins 2 caractères pour chercher un judoka.')
      return
    }
    setSearching(true)
    setError(null)
    try {
      const res = await window.judovac.searchJudokas(q)
      if (!res.ok) {
        setError(res.error)
        setHits([])
        return
      }
      const inTeam = new Set(activeTeam?.judokaIds ?? [])
      setHits(
        res.data.items
          .filter((j) => !inTeam.has(j.id))
          .sort((a, b) => formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr'))
          .slice(0, 40)
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recherche impossible')
    } finally {
      setSearching(false)
    }
  }

  async function remove(team: Team): Promise<void> {
    if (!window.confirm(`Supprimer l’équipe ${teamDisplayName(team)} ?`)) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const settingsRes = await window.judovac.getSettings()
      if (!settingsRes.ok) {
        setError(settingsRes.error)
        return
      }
      const next = normalizeTeams(settingsRes.data.teams).filter((t) => t.id !== team.id)
      const saved = await window.judovac.setSettings({ teams: next })
      if (!saved.ok) {
        setError(saved.error)
        return
      }
      setTeams(normalizeTeams(saved.data.teams))
      if (activeTeam?.id === team.id) resetClubForm()
      setMessage('Équipe supprimée.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suppression impossible')
    } finally {
      setBusy(false)
    }
  }

  function memberRow(j: Judoka) {
    return (
      <li key={j.id} className="flex items-center justify-between gap-2 text-sm">
        <span>
          <span className="font-medium text-judo-navy">{formatJudokaFullName(j)}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {j.displayId}
            {j.weightKg ? ` · ${j.weightKg} kg` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Modifier"
            disabled={busy}
            onClick={() => setEditingJudoka(j)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void removeMember(j.id)}
          >
            Retirer
          </Button>
        </span>
      </li>
    )
  }

  if ((creating || editingJudoka) && activeTeam) {
    return (
      <JudokaFormPage
        embedded={embedded}
        createdBy={createdBy}
        createdWorkstation={createdWorkstation}
        editing={editingJudoka}
        forcedClub={activeTeam.club}
        onBack={() => {
          setCreating(false)
          setEditingJudoka(null)
        }}
        onSaved={async (result) => {
          const created = result?.judoka
          if (editingJudoka) {
            await reload()
            setEditingJudoka(null)
            setMessage('Fiche judoka enregistrée.')
            return
          }
          if (created) {
            await addMember(created)
          } else {
            await reload()
            const listed = await window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
            if (listed.ok && activeTeam) {
              const newest = listed.data.items
                .filter(
                  (j) =>
                    (j.club ?? '').trim().toLowerCase() === activeTeam.club.trim().toLowerCase()
                )
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
              if (newest && !activeTeam.judokaIds.includes(newest.id)) {
                await addMember(newest)
              }
            }
          }
          setCreating(false)
          setMessage('Judoka créé et ajouté à l’équipe.')
        }}
      />
    )
  }

  return (
    <AppShell
      embedded={embedded}
      title="Nouvelle équipe"
      subtitle="Validez un club comme équipe, puis importez ou créez ses judokas."
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
        <div className="rounded-xl border bg-white/75 p-5 space-y-4 max-w-3xl">
          <Label className="text-base">1. Club à valider comme équipe</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={clubMode === 'existing' ? 'accent' : 'outline'}
              disabled={busy}
              onClick={() => setClubMode('existing')}
            >
              Club existant
            </Button>
            <Button
              type="button"
              size="sm"
              variant={clubMode === 'new' ? 'accent' : 'outline'}
              disabled={busy}
              onClick={() => setClubMode('new')}
            >
              Nouveau club
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {clubMode === 'existing' ? (
              <div className="space-y-1">
                <Label htmlFor="team-club">Club existant</Label>
                <select
                  id="team-club"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={club}
                  disabled={busy}
                  onChange={(e) => setClub(e.target.value)}
                >
                  <option value="">— Sélectionner un club —</option>
                  {clubs.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="team-new-club">Nom du nouveau club</Label>
                <Input
                  id="team-new-club"
                  value={newClub}
                  placeholder="Ex. Judo Kinshasa"
                  disabled={busy}
                  onChange={(e) => setNewClub(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="team-name">Nom d’équipe (optionnel)</Label>
              <Input
                id="team-name"
                value={name}
                placeholder={chosenClub || 'Nom du club'}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="accent" disabled={busy} onClick={() => void validateClub()}>
              <Check className="h-4 w-4" />
              {busy ? 'Validation…' : 'Valider comme équipe'}
            </Button>
            {activeTeam && (
              <Button variant="outline" disabled={busy} onClick={resetClubForm}>
                Autre club
              </Button>
            )}
          </div>
        </div>

        {error && <p className="max-w-3xl text-sm text-destructive">{error}</p>}
        {message && <p className="max-w-3xl text-sm text-emerald-700">{message}</p>}

        <div className="rounded-xl border bg-white/75 p-5 space-y-3 max-w-3xl">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-judo-navy" />
            <Label className="text-base">Équipes validées</Label>
          </div>
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune équipe. Validez un club existant ou créez-en un nouveau.
            </p>
          ) : (
            <ul className="space-y-2">
              {teams.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-lg border bg-slate-50/80 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-judo-navy">{teamDisplayName(t)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.judokaIds.length} judoka(s)
                      {t.createdBy ? ` · ${t.createdBy}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Ouvrir"
                      disabled={busy}
                      onClick={() => openTeam(t)}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Supprimer"
                      disabled={busy}
                      onClick={() => void remove(t)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {modalOpen && activeTeam && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
          <div className="relative my-4 w-full max-w-3xl rounded-xl border bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-judo-navy">
                  Judokas de {teamDisplayName(activeTeam)}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Importez ou créez des judokas, puis désignez le titulaire et le remplaçant de
                  chaque catégorie de poids.
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Fermer"
                onClick={() => setModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Input
                  className="min-w-[12rem] flex-1"
                  value={query}
                  placeholder="Nom, prénom, n°…"
                  disabled={busy || searching}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void search()
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || searching}
                  onClick={() => void search()}
                >
                  <Search className="h-4 w-4" />
                  {searching ? 'Recherche…' : 'Chercher'}
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  disabled={busy}
                  onClick={() => setCreating(true)}
                >
                  <UserPlus className="h-4 w-4" />
                  Nouveau judoka
                </Button>
              </div>

              {hits.length > 0 && (
                <ul className="space-y-1 rounded-lg border bg-slate-50/80 p-2">
                  {hits.map((j) => (
                    <li
                      key={j.id}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm"
                    >
                      <div>
                        <p className="font-medium text-judo-navy">{formatJudokaFullName(j)}</p>
                        <p className="text-xs text-muted-foreground">
                          {[j.displayId, j.club || 'Sans club', j.category || null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void addMember(j)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Importer
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {hits.length === 0 && query.trim().length >= 2 && !searching && (
                <p className="text-xs text-muted-foreground">
                  Aucun judoka trouvé hors de cette équipe. Créez-en un nouveau si besoin.
                </p>
              )}

              {members.length === 0 ? (
                <p className="text-sm text-amber-800">
                  Aucun judoka dans cette équipe. Importez un judoka existant ou créez-en un.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {members.length} judoka(s) dans l’équipe
                  </p>
                  {weightClasses.length === 0 && (
                    <p className="text-xs text-amber-800">
                      Définissez les catégories de poids (avec sexe) dans Tirage → Par équipe pour
                      classer les titulaires et remplaçants.
                    </p>
                  )}
                  {classified.blocks.map(({ wc, items }) => {
                    const lineup = (activeTeam.lineups ?? []).find(
                      (l) =>
                        l.sex === wc.sex &&
                        (l.weightLabel.trim().toLowerCase() === wc.label.trim().toLowerCase() ||
                          (Math.abs(l.minKg - wc.minKg) < 1e-6 &&
                            Math.abs(l.maxKg - wc.maxKg) < 1e-6))
                    )
                    const sexLabel = wc.sex === 'F' ? 'Filles' : 'Garçons'
                    return (
                      <div key={wc.id} className="rounded-lg border bg-slate-50/80 p-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          {sexLabel} · {wc.label}
                          {` (${wc.minKg}–${wc.maxKg} kg)`}
                        </p>
                        {items.length > 0 && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Judoka principal</Label>
                              <select
                                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                value={lineup?.principalId ?? ''}
                                disabled={busy}
                                onChange={(e) =>
                                  void saveLineup(wc, {
                                    principalId: e.target.value || null
                                  })
                                }
                              >
                                <option value="">— Choisir —</option>
                                {items.map((j) => (
                                  <option key={j.id} value={j.id}>
                                    {formatJudokaFullName(j)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Remplaçant</Label>
                              <select
                                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                value={lineup?.substituteId ?? ''}
                                disabled={busy}
                                onChange={(e) =>
                                  void saveLineup(wc, {
                                    substituteId: e.target.value || null
                                  })
                                }
                              >
                                <option value="">— Aucun —</option>
                                {items
                                  .filter((j) => j.id !== (lineup?.principalId ?? ''))
                                  .map((j) => (
                                    <option key={j.id} value={j.id}>
                                      {formatJudokaFullName(j)}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </div>
                        )}
                        {items.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Aucun judoka dans cette catégorie.</p>
                        ) : (
                          <ul className="space-y-1">{items.map((j) => memberRow(j))}</ul>
                        )}
                      </div>
                    )
                  })}
                  {classified.uncategorized.length > 0 && (
                    <div className="rounded-lg border bg-slate-50/80 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Non classés</p>
                      <ul className="space-y-1">
                        {classified.uncategorized.map((j) => memberRow(j))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
