import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRightLeft,
  Building2,
  Check,
  FolderOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  X
} from 'lucide-react'
import type { Judoka, Sex } from '@shared/types/judoka'
import type { TeamWeightClassRange } from '@shared/types/settings'
import {
  createTeamId,
  judokasOnTeam,
  normalizeTeams,
  sanitizeLineupsForClasses,
  teamDisplayName,
  upsertTeamLineup,
  type Team
} from '@shared/types/teams'
import { formatJudokaFullName } from '@shared/utils/judoka'
import { mergeRegisteredClubNames } from '@shared/utils/clubs'
import { judoVacancesWeightClasses, normalizeTeamWeightClasses } from '@shared/utils/team-tirage'
import { createWeightClassId, suggestWeightClassLabel } from '@shared/utils/tirage'
import { StatTile } from '@/components/StatTile'
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

function emptyDraftClass(): TeamWeightClassRange {
  return {
    id: createWeightClassId(),
    label: '-66 kg',
    minKg: 0,
    maxKg: 66,
    sex: 'M'
  }
}

function stripTeamMember(team: Team, judokaId: string): Team {
  return {
    ...team,
    judokaIds: team.judokaIds.filter((id) => id !== judokaId),
    lineups: (team.lineups ?? []).map((l) => ({
      ...l,
      principalId: l.principalId === judokaId ? null : l.principalId,
      substituteId: l.substituteId === judokaId ? null : l.substituteId
    })),
    updatedAt: new Date().toISOString()
  }
}

/**
 * Inscription d’une équipe : club + judokas, catégories de poids indépendantes du tirage.
 */
export function TeamFormPage({
  createdBy,
  createdWorkstation = 'poste',
  onBack,
  embedded = false
}: Props) {
  const [teams, setTeams] = useState<Team[]>([])
  const [judokas, setJudokas] = useState<Judoka[]>([])
  const [weightClasses, setWeightClasses] = useState<TeamWeightClassRange[]>([])
  const [clubName, setClubName] = useState('')
  const [name, setName] = useState('')
  const [activeTeam, setActiveTeam] = useState<Team | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingJudoka, setEditingJudoka] = useState<Judoka | null>(null)
  const [draftClass, setDraftClass] = useState<TeamWeightClassRange>(emptyDraftClass)
  const [clubQuery, setClubQuery] = useState('')
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null)
  const [editClubName, setEditClubName] = useState('')

  async function reload(teamId?: string): Promise<void> {
    const [settingsRes, listed] = await Promise.all([
      window.judovac.getSettings(),
      window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
    ])
    const listedItems = listed.ok ? listed.data.items : []
    if (listed.ok) setJudokas(listedItems)
    if (!settingsRes.ok) return
    const nextTeams = normalizeTeams(settingsRes.data.teams)
    const classes = normalizeTeamWeightClasses(settingsRes.data.teamWeightClasses ?? [])
    setTeams(nextTeams)
    setWeightClasses(classes)
    const id = teamId ?? activeTeam?.id
    if (!id) return
    const found = nextTeams.find((t) => t.id === id) ?? null
    if (!found) {
      setActiveTeam(null)
      return
    }
    setActiveTeam(found)
  }

  useEffect(() => {
    void reload().catch((e) => {
      setError(e instanceof Error ? e.message : 'Chargement impossible')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chargement initial
  }, [])

  const chosenClub = clubName.trim()

  const teamStats = useMemo(() => {
    const registered = teams.length
    const rosterIds = new Set<string>()
    for (const t of teams) {
      for (const id of t.judokaIds) rosterIds.add(id)
    }
    const withJudokas = teams.filter((t) => t.judokaIds.length > 0).length
    return {
      registered,
      withJudokas,
      withoutJudokas: registered - withJudokas,
      judokasOnTeams: rosterIds.size
    }
  }, [teams])

  const filteredTeams = useMemo(() => {
    const q = clubQuery.trim().toLowerCase()
    const list = [...teams].sort((a, b) => a.club.localeCompare(b.club, 'fr'))
    if (!q) return list
    return list.filter((t) => t.club.toLowerCase().includes(q))
  }, [teams, clubQuery])

  const members = useMemo(() => {
    if (!activeTeam) return []
    return judokasOnTeam(activeTeam, judokas).sort((a, b) =>
      formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr')
    )
  }, [judokas, activeTeam])

  const otherTeams = useMemo(() => {
    if (!activeTeam) return []
    return [...teams]
      .filter((t) => t.id !== activeTeam.id)
      .sort((a, b) => a.club.localeCompare(b.club, 'fr'))
  }, [teams, activeTeam])

  const classified = useMemo(() => {
    const used = new Set<string>()
    const blocks = weightClasses.map((wc) => {
      const items = members.filter((j) => !used.has(j.id) && inWeightClass(j, wc))
      for (const j of items) used.add(j.id)
      return { wc, items }
    })
    const uncategorized = members.filter((j) => !used.has(j.id))
    return { blocks, uncategorized }
  }, [members, weightClasses])

  function resetClubForm(): void {
    setClubName('')
    setName('')
    setActiveTeam(null)
    setModalOpen(false)
    setCreating(false)
    setEditingJudoka(null)
    setEditingTeamId(null)
    setEditClubName('')
  }

  function openTeam(team: Team): void {
    setActiveTeam(team)
    setClubName(team.club)
    setName(team.name === team.club ? '' : team.name)
    setError(null)
    setMessage(null)
    setCreating(false)
    setEditingJudoka(null)
    setModalOpen(true)
    void reload(team.id)
  }

  async function persistTeam(
    nextTeam: Team,
    extraClubs: string[] = [],
    classes: TeamWeightClassRange[] = weightClasses,
    allJudokas: Judoka[] = judokas
  ): Promise<Team | null> {
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
    const membersForTeam = allJudokas.filter((j) => nextTeam.judokaIds.includes(j.id))
    const cleaned = sanitizeLineupsForClasses(nextTeam, membersForTeam, classes)
    const saved = await window.judovac.setSettings({
      teams: normalizeTeams([...others, cleaned]),
      clubs: clubsNext
    })
    if (!saved.ok) {
      setError(saved.error)
      return null
    }
    const stored = normalizeTeams(saved.data.teams)
    setTeams(stored)
    return stored.find((t) => t.id === nextTeam.id) ?? nextTeam
  }

  async function persistTeamPatches(patches: Team[]): Promise<Team[] | null> {
    if (patches.length === 0) return teams
    const settingsRes = await window.judovac.getSettings()
    if (!settingsRes.ok) {
      setError(settingsRes.error)
      return null
    }
    const byId = new Map(patches.map((t) => [t.id, t]))
    const current = normalizeTeams(settingsRes.data.teams)
    const next = current.map((t) => {
      const patch = byId.get(t.id)
      if (!patch) return t
      const membersForTeam = judokas.filter((j) => patch.judokaIds.includes(j.id))
      return sanitizeLineupsForClasses(patch, membersForTeam, weightClasses)
    })
    const saved = await window.judovac.setSettings({ teams: normalizeTeams(next) })
    if (!saved.ok) {
      setError(saved.error)
      return null
    }
    const stored = normalizeTeams(saved.data.teams)
    setTeams(stored)
    return stored
  }

  async function persistWeightClasses(classes: TeamWeightClassRange[]): Promise<boolean> {
    const normalized = normalizeTeamWeightClasses(classes)
    const saved = await window.judovac.setSettings({ teamWeightClasses: normalized })
    if (!saved.ok) {
      setError(saved.error)
      return false
    }
    setWeightClasses(normalizeTeamWeightClasses(saved.data.teamWeightClasses ?? normalized))
    return true
  }

  async function validateClub(): Promise<void> {
    if (!chosenClub) {
      setError('Saisissez le nom du club.')
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
      const nextTeam: Team = {
        id: existing?.id ?? createTeamId(),
        club: existing?.club ?? chosenClub,
        name: name.trim() || existing?.name || chosenClub,
        judokaIds: existing?.judokaIds ?? [],
        lineups: existing?.lineups ?? [],
        createdBy: existing?.createdBy || createdBy,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      const saved = await persistTeam(nextTeam)
      if (!saved) return
      setActiveTeam(saved)
      setClubName(saved.club)
      setModalOpen(true)
      setMessage(`Club « ${teamDisplayName(saved)} » inscrit comme équipe.`)
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
      const nextTeam: Team = {
        ...activeTeam,
        judokaIds: [...new Set([...activeTeam.judokaIds, judoka.id])],
        updatedAt: new Date().toISOString()
      }
      const saved = await persistTeam(nextTeam)
      if (!saved) return
      setActiveTeam(saved)
      setJudokas((prev) =>
        prev.some((j) => j.id === judoka.id) ? prev : [...prev, judoka]
      )
      setMessage(`${formatJudokaFullName(judoka)} inscrit dans ${teamDisplayName(saved)}.`)
      await reload(saved.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Inscription impossible')
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(judokaId: string): Promise<void> {
    if (!activeTeam) return
    setBusy(true)
    setError(null)
    try {
      const saved = await persistTeam(stripTeamMember(activeTeam, judokaId))
      if (!saved) return
      setActiveTeam(saved)
    } finally {
      setBusy(false)
    }
  }

  async function moveMember(judoka: Judoka, targetTeamId: string): Promise<void> {
    if (!activeTeam) return
    const target = teams.find((t) => t.id === targetTeamId)
    if (!target || target.id === activeTeam.id) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const source = stripTeamMember(activeTeam, judoka.id)
      const dest: Team = {
        ...target,
        judokaIds: [...new Set([...target.judokaIds, judoka.id])],
        updatedAt: new Date().toISOString()
      }
      const stored = await persistTeamPatches([source, dest])
      if (!stored) return
      const clubRes = await window.judovac.updateJudoka(judoka.id, { club: dest.club })
      if (!clubRes.ok) {
        setError(clubRes.error)
      }
      const savedSource = stored.find((t) => t.id === source.id) ?? source
      setActiveTeam(savedSource)
      setJudokas((prev) =>
        prev.map((j) => (j.id === judoka.id ? { ...j, club: dest.club } : j))
      )
      setMessage(
        `${formatJudokaFullName(judoka)} déplacé vers ${teamDisplayName(dest)}.`
      )
      await reload(savedSource.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Déplacement impossible')
    } finally {
      setBusy(false)
    }
  }

  async function saveLineup(
    wc: TeamWeightClassRange,
    patch: { principalId?: string | null; substituteId?: string | null }
  ): Promise<void> {
    if (!activeTeam) return
    const eligible = members.filter((j) => inWeightClass(j, wc))
    const allowed = new Set(eligible.map((j) => j.id))
    const nextPatch = { ...patch }
    if (nextPatch.principalId && !allowed.has(nextPatch.principalId)) nextPatch.principalId = null
    if (nextPatch.substituteId && !allowed.has(nextPatch.substituteId)) nextPatch.substituteId = null
    setBusy(true)
    setError(null)
    try {
      const saved = await persistTeam(
        upsertTeamLineup(
          activeTeam,
          { sex: wc.sex, label: wc.label, minKg: wc.minKg, maxKg: wc.maxKg },
          nextPatch
        )
      )
      if (!saved) return
      setActiveTeam(saved)
    } finally {
      setBusy(false)
    }
  }

  async function addWeightClass(): Promise<void> {
    const next = normalizeTeamWeightClasses([...weightClasses, draftClass])
    setBusy(true)
    setError(null)
    try {
      if (!(await persistWeightClasses(next))) return
      setDraftClass(emptyDraftClass())
    } finally {
      setBusy(false)
    }
  }

  async function updateWeightClass(id: string, patch: Partial<TeamWeightClassRange>): Promise<void> {
    const next = weightClasses.map((row) => {
      if (row.id !== id) return row
      const updated = { ...row, ...patch }
      if (patch.maxKg != null && /^-\s*[\d.,]+\s*kg$/i.test(row.label.trim())) {
        updated.label = suggestWeightClassLabel(Number(patch.maxKg) || 0)
      }
      return updated
    })
    setWeightClasses(next)
    await persistWeightClasses(next)
    if (activeTeam) {
      const saved = await persistTeam(activeTeam, [], next)
      if (saved) setActiveTeam(saved)
    }
  }

  async function removeWeightClass(id: string): Promise<void> {
    const next = weightClasses.filter((c) => c.id !== id)
    await persistWeightClasses(next)
    if (activeTeam) {
      const saved = await persistTeam(activeTeam, [], next)
      if (saved) setActiveTeam(saved)
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

  function startRename(team: Team): void {
    setEditingTeamId(team.id)
    setEditClubName(team.club)
    setError(null)
    setMessage(null)
  }

  function cancelRename(): void {
    setEditingTeamId(null)
    setEditClubName('')
  }

  async function renameTeamClub(team: Team): Promise<void> {
    const club = editClubName.trim()
    if (!club) {
      setError('Saisissez le nom du club.')
      return
    }
    const oldClub = team.club.trim()
    if (club.toLowerCase() === oldClub.toLowerCase()) {
      if (club === oldClub) {
        cancelRename()
        return
      }
    }
    const duplicate = teams.some(
      (t) => t.id !== team.id && t.club.trim().toLowerCase() === club.toLowerCase()
    )
    if (duplicate) {
      setError(`Le club « ${club} » est déjà inscrit comme équipe.`)
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const nameWasClub =
        !team.name.trim() || team.name.trim().toLowerCase() === oldClub.toLowerCase()
      const saved = await persistTeam({
        ...team,
        club,
        name: nameWasClub ? club : team.name,
        updatedAt: new Date().toISOString()
      })
      if (!saved) return
      const membersToRename = judokas.filter(
        (j) =>
          team.judokaIds.includes(j.id) && j.club.trim().toLowerCase() === oldClub.toLowerCase()
      )
      for (const j of membersToRename) {
        const res = await window.judovac.updateJudoka(j.id, { club })
        if (!res.ok) {
          setError(res.error)
          break
        }
      }
      if (activeTeam?.id === saved.id) {
        setActiveTeam(saved)
        setClubName(saved.club)
        setName(saved.name === saved.club ? '' : saved.name)
      }
      await reload(saved.id)
      cancelRename()
      setMessage(`Club renommé en « ${saved.club} ».`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Modification impossible')
    } finally {
      setBusy(false)
    }
  }

  function memberRow(j: Judoka) {
    return (
      <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <span className="font-medium text-judo-navy">{formatJudokaFullName(j)}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {j.displayId}
            {j.weightKg ? ` · ${j.weightKg} kg` : ''}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-1">
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
          {otherTeams.length > 0 && (
            <label className="flex items-center gap-1" title="Déplacer vers un autre club">
              <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <select
                className="h-8 max-w-[11rem] rounded-md border border-input bg-background px-1.5 text-xs"
                value=""
                disabled={busy}
                aria-label={`Déplacer ${formatJudokaFullName(j)} vers un autre club`}
                onChange={(e) => {
                  const targetId = e.target.value
                  if (targetId) void moveMember(j, targetId)
                }}
              >
                <option value="">Déplacer vers…</option>
                {otherTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {teamDisplayName(t)}
                  </option>
                ))}
              </select>
            </label>
          )}
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
        skipDuplicateCheck
        onBack={() => {
          setCreating(false)
          setEditingJudoka(null)
        }}
        onSaved={async (result) => {
          const created = result?.judoka
          if (editingJudoka) {
            await reload(activeTeam.id)
            setEditingJudoka(null)
            setMessage('Fiche judoka enregistrée.')
            return
          }
          if (created?.id) {
            await addMember(created)
          } else {
            await reload(activeTeam.id)
          }
          setCreating(false)
          setMessage('Judoka inscrit dans l’équipe.')
        }}
      />
    )
  }

  return (
    <AppShell
      embedded={embedded}
      title="Par Équipe"
      subtitle="Inscrivez un club comme équipe, puis ajoutez ses judokas et catégories de poids."
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
        <div className="rounded-xl border bg-white/75 p-5 space-y-3 max-w-3xl">
          <Label className="text-base">Statistiques</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              icon={<Building2 className="h-5 w-5" />}
              label="Clubs enregistrés"
              value={String(teamStats.registered)}
              hint="Clubs inscrits comme équipe"
            />
            <StatTile
              icon={<UserCheck className="h-5 w-5" />}
              label="Clubs avec judokas"
              value={String(teamStats.withJudokas)}
              hint="Au moins un judoka dans l’équipe"
              tone={teamStats.withJudokas > 0 ? 'ok' : 'muted'}
            />
            <StatTile
              icon={<UserX className="h-5 w-5" />}
              label="Clubs sans judokas"
              value={String(teamStats.withoutJudokas)}
              hint="Équipes encore vides"
              tone={teamStats.withoutJudokas > 0 ? 'warn' : 'muted'}
            />
            <StatTile
              icon={<Users className="h-5 w-5" />}
              label="Judokas par équipe"
              value={String(teamStats.judokasOnTeams)}
              hint="Judokas inscrits dans une équipe"
            />
          </div>
        </div>

        <div className="rounded-xl border bg-white/75 p-5 space-y-4 max-w-3xl">
          <Label className="text-base">1. Club à inscrire comme équipe</Label>
          <p className="text-sm text-muted-foreground">
            Un club déjà présent en individuel peut être inscrit ici : ce n’est pas un doublon.
            Seuls les judokas enregistrés dans Par Équipe font partie de l’équipe.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="team-club">Nom du club</Label>
              <Input
                id="team-club"
                value={clubName}
                placeholder="Ex. Judo Kinshasa"
                disabled={busy}
                onChange={(e) => setClubName(e.target.value)}
              />
            </div>
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
              {busy ? 'Inscription…' : 'Valider comme équipe'}
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
              Aucune équipe. Inscrivez un club pour commencer.
            </p>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={clubQuery}
                  placeholder="Rechercher un club par nom…"
                  onChange={(e) => setClubQuery(e.target.value)}
                />
              </div>
              {filteredTeams.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun club ne correspond à « {clubQuery.trim()} ».
                </p>
              ) : (
                <ul className="space-y-2">
                  {filteredTeams.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-2 rounded-lg border bg-slate-50/80 px-3 py-2"
                    >
                      {editingTeamId === t.id ? (
                        <form
                          className="flex min-w-0 flex-1 items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void renameTeamClub(t)
                          }}
                        >
                          <Input
                            autoFocus
                            value={editClubName}
                            disabled={busy}
                            placeholder="Nom du club"
                            onChange={(e) => setEditClubName(e.target.value)}
                          />
                          <Button
                            type="submit"
                            size="icon"
                            variant="ghost"
                            title="Enregistrer"
                            disabled={busy || !editClubName.trim()}
                          >
                            <Check className="h-4 w-4 text-emerald-700" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Annuler"
                            disabled={busy}
                            onClick={cancelRename}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </form>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-judo-navy">{teamDisplayName(t)}</p>
                            <p className="text-xs text-muted-foreground">
                              {judokasOnTeam(t, judokas).length} judoka(s)
                              {t.createdBy ? ` · ${t.createdBy}` : ''}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1">
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
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              title="Modifier"
                              disabled={busy}
                              onClick={() => startRename(t)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
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
                  Créez les catégories (seuil de poids et sexe). Chaque judoka inscrit se place
                  automatiquement. Vous pouvez déplacer un judoka vers un autre club inscrit.
                  Le titulaire et le remplaçant sont choisis ici ; le tirage les reprend tels quels.
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

            {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
            {message && <p className="mb-3 text-sm text-emerald-700">{message}</p>}

            <div className="space-y-4">
              <div className="rounded-lg border bg-slate-50/80 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-sm">Catégories de poids</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (
                        weightClasses.length > 0 &&
                        !window.confirm(
                          'Remplacer les catégories actuelles par -60, -66, -73, -81, -90, +90 kg ?'
                        )
                      ) {
                        return
                      }
                      void persistWeightClasses(judoVacancesWeightClasses('M'))
                    }}
                  >
                    Judo Vacances
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto]">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Libellé</Label>
                    <Input
                      value={draftClass.label}
                      placeholder="-66 kg"
                      disabled={busy}
                      onChange={(e) => setDraftClass((c) => ({ ...c, label: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Sexe</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={draftClass.sex}
                      disabled={busy}
                      onChange={(e) =>
                        setDraftClass((c) => ({ ...c, sex: e.target.value as Sex }))
                      }
                    >
                      <option value="M">Garçons</option>
                      <option value="F">Filles</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Min (kg)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={draftClass.minKg}
                      disabled={busy}
                      onChange={(e) =>
                        setDraftClass((c) => ({ ...c, minKg: Number(e.target.value) || 0 }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Max (kg)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={draftClass.maxKg}
                      disabled={busy}
                      onChange={(e) => {
                        const maxKg = Number(e.target.value) || 0
                        setDraftClass((c) => ({
                          ...c,
                          maxKg,
                          label: /^-\s*[\d.,]+\s*kg$/i.test(c.label.trim())
                            ? suggestWeightClassLabel(maxKg)
                            : c.label
                        }))
                      }}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void addWeightClass()}
                    >
                      <Plus className="h-4 w-4" />
                      Ajouter
                    </Button>
                  </div>
                </div>
                {weightClasses.length === 0 && (
                  <p className="text-xs text-amber-800">
                    Ajoutez au moins une catégorie pour classer les judokas et désigner titulaire /
                    remplaçant.
                  </p>
                )}
              </div>

              <Button
                type="button"
                variant="accent"
                disabled={busy}
                onClick={() => setCreating(true)}
              >
                <UserPlus className="h-4 w-4" />
                Nouveau judoka
              </Button>

              {members.length === 0 ? (
                <p className="text-sm text-amber-800">
                  Aucun judoka dans cette équipe. Inscrivez-en un : il sera classé selon son sexe et
                  son poids.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {members.length} judoka(s) dans l’équipe
                  </p>
                  {classified.blocks.map(({ wc, items }) => {
                    const lineup = (activeTeam.lineups ?? []).find(
                      (l) =>
                        l.sex === wc.sex &&
                        (l.weightLabel.trim().toLowerCase() === wc.label.trim().toLowerCase() ||
                          (Math.abs(l.minKg - wc.minKg) < 1e-6 &&
                            Math.abs(l.maxKg - wc.maxKg) < 1e-6))
                    )
                    const principalId = items.some((j) => j.id === lineup?.principalId)
                      ? lineup!.principalId
                      : ''
                    const substituteId = items.some((j) => j.id === lineup?.substituteId)
                      ? lineup!.substituteId
                      : ''
                    const sexLabel = wc.sex === 'F' ? 'Filles' : 'Garçons'
                    return (
                      <div key={wc.id} className="rounded-lg border bg-slate-50/80 p-3 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            {sexLabel} · {wc.label}
                            {` (${wc.minKg}–${wc.maxKg} kg)`}
                          </p>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Supprimer la catégorie"
                            disabled={busy}
                            onClick={() => void removeWeightClass(wc.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-4">
                          <Input
                            value={wc.label}
                            disabled={busy}
                            onChange={(e) => void updateWeightClass(wc.id, { label: e.target.value })}
                          />
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={wc.sex}
                            disabled={busy}
                            onChange={(e) =>
                              void updateWeightClass(wc.id, { sex: e.target.value as Sex })
                            }
                          >
                            <option value="M">Garçons</option>
                            <option value="F">Filles</option>
                          </select>
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            value={wc.minKg}
                            disabled={busy}
                            onChange={(e) =>
                              void updateWeightClass(wc.id, { minKg: Number(e.target.value) || 0 })
                            }
                          />
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            value={wc.maxKg}
                            disabled={busy}
                            onChange={(e) =>
                              void updateWeightClass(wc.id, { maxKg: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                        {items.length > 0 && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Judoka principal</Label>
                              <select
                                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                value={principalId ?? ''}
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
                                value={substituteId ?? ''}
                                disabled={busy}
                                onChange={(e) =>
                                  void saveLineup(wc, {
                                    substituteId: e.target.value || null
                                  })
                                }
                              >
                                <option value="">— Aucun —</option>
                                {items
                                  .filter((j) => j.id !== (principalId ?? ''))
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
                          <p className="text-xs text-muted-foreground">
                            Aucun judoka dans cette catégorie pour le moment.
                          </p>
                        ) : (
                          <ul className="space-y-1">{items.map((j) => memberRow(j))}</ul>
                        )}
                      </div>
                    )
                  })}
                  {classified.uncategorized.length > 0 && (
                    <div className="rounded-lg border bg-slate-50/80 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Non classés (poids ou sexe hors seuils)
                      </p>
                      <p className="text-xs text-amber-800">
                        Ces judokas ne peuvent pas être titulaires ni remplaçants : leur poids ne
                        correspond à aucune catégorie créée.
                      </p>
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
