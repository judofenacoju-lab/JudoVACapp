import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Pencil, Save, Trash2, Users } from 'lucide-react'
import type { Judoka } from '@shared/types/judoka'
import { createTeamId, normalizeTeams, teamDisplayName, type Team } from '@shared/types/teams'
import { formatJudokaFullName, resolveJudokaCategory } from '@shared/utils/judoka'
import { mergeRegisteredClubNames } from '@shared/utils/clubs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'

interface Props {
  createdBy: string
  onBack: () => void
  embedded?: boolean
}

/**
 * Enregistrement d’une équipe : un club + ses judokas pour les combats par équipe.
 */
export function TeamFormPage({ createdBy, onBack, embedded = false }: Props) {
  const [teams, setTeams] = useState<Team[]>([])
  const [clubs, setClubs] = useState<string[]>([])
  const [judokas, setJudokas] = useState<Judoka[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [club, setClub] = useState('')
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function reload(): Promise<void> {
    const [settingsRes, listed] = await Promise.all([
      window.judovac.getSettings(),
      window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
    ])
    if (settingsRes.ok) {
      setTeams(normalizeTeams(settingsRes.data.teams))
      const fromJudokas = listed.ok
        ? listed.data.items.map((j) => j.club).filter(Boolean)
        : []
      setClubs(mergeRegisteredClubNames([...(settingsRes.data.clubs ?? []), ...fromJudokas]))
    }
    if (listed.ok) setJudokas(listed.data.items)
  }

  useEffect(() => {
    void reload().catch((e) => {
      setError(e instanceof Error ? e.message : 'Chargement impossible')
    })
  }, [])

  const clubJudokas = useMemo(() => {
    const key = club.trim().toLowerCase()
    if (!key) return []
    return judokas
      .filter((j) => (j.club ?? '').trim().toLowerCase() === key)
      .sort((a, b) => formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr'))
  }, [judokas, club])

  const grouped = useMemo(() => {
    const map = new Map<string, Judoka[]>()
    for (const j of clubJudokas) {
      const cat = resolveJudokaCategory(j.birthDate, j.category) || 'Sans catégorie'
      const label = `${j.sex === 'F' ? 'Filles' : 'Garçons'} · ${cat}`
      const list = map.get(label) ?? []
      list.push(j)
      map.set(label, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  }, [clubJudokas])

  function resetForm(): void {
    setEditingId(null)
    setClub('')
    setName('')
    setSelected(new Set())
  }

  function loadTeam(team: Team): void {
    setEditingId(team.id)
    setClub(team.club)
    setName(team.name === team.club ? '' : team.name)
    setSelected(new Set(team.judokaIds))
    setError(null)
    setMessage(null)
  }

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll(ids: string[], on: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function save(): Promise<void> {
    const clubName = club.trim()
    if (!clubName) {
      setError('Choisissez un club.')
      return
    }
    if (selected.size === 0) {
      setError('Sélectionnez au moins un judoka de ce club.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const settingsRes = await window.judovac.getSettings()
      if (!settingsRes.ok) {
        setError(settingsRes.error)
        return
      }
      const now = new Date().toISOString()
      const current = normalizeTeams(settingsRes.data.teams)
      const teamName = name.trim() || clubName
      const existing =
        current.find((t) => t.id === editingId) ??
        current.find((t) => t.club.trim().toLowerCase() === clubName.toLowerCase())
      const nextTeam: Team = {
        id: existing?.id ?? createTeamId(),
        club: clubName,
        name: teamName,
        judokaIds: [...selected],
        createdBy: existing?.createdBy || createdBy,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      const others = current.filter(
        (t) =>
          t.id !== nextTeam.id && t.club.trim().toLowerCase() !== clubName.toLowerCase()
      )
      const clubs = mergeRegisteredClubNames([...(settingsRes.data.clubs ?? []), clubName])
      const saved = await window.judovac.setSettings({
        teams: normalizeTeams([...others, nextTeam]),
        clubs
      })
      if (!saved.ok) {
        setError(saved.error)
        return
      }
      setTeams(normalizeTeams(saved.data.teams))
      setClubs(mergeRegisteredClubNames([...(saved.data.clubs ?? []), ...judokas.map((j) => j.club)]))
      setMessage(
        existing
          ? `Équipe ${teamDisplayName(nextTeam)} mise à jour (${nextTeam.judokaIds.length} judoka(s)).`
          : `Équipe ${teamDisplayName(nextTeam)} enregistrée (${nextTeam.judokaIds.length} judoka(s)).`
      )
      resetForm()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible')
    } finally {
      setBusy(false)
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
      if (editingId === team.id) resetForm()
      setMessage('Équipe supprimée.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suppression impossible')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell
      embedded={embedded}
      title="Nouvelle équipe"
      subtitle="Associez un club à ses judokas pour les combats par équipe."
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="team-club">Club</Label>
              <select
                id="team-club"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={club}
                disabled={busy}
                onChange={(e) => {
                  setClub(e.target.value)
                  setSelected(new Set())
                }}
              >
                <option value="">— Sélectionner un club —</option>
                {clubs.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="team-name">Nom d’équipe (optionnel)</Label>
              <Input
                id="team-name"
                value={name}
                placeholder={club || 'Nom du club'}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          {club && clubJudokas.length === 0 && (
            <p className="text-sm text-amber-800">
              Aucun judoka enregistré pour ce club. Enregistrez d’abord les judokas via{' '}
              <strong>Nouveau judoka</strong>.
            </p>
          )}

          {grouped.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Judokas du club ({selected.size} sélectionné(s))</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    toggleAll(
                      clubJudokas.map((j) => j.id),
                      selected.size < clubJudokas.length
                    )
                  }
                >
                  {selected.size < clubJudokas.length ? 'Tout cocher' : 'Tout décocher'}
                </Button>
              </div>
              {grouped.map(([label, items]) => (
                <div key={label} className="rounded-lg border bg-slate-50/80 p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  <ul className="space-y-1">
                    {items.map((j) => (
                      <li key={j.id}>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-judo-red"
                            checked={selected.has(j.id)}
                            disabled={busy}
                            onChange={() => toggle(j.id)}
                          />
                          <span className="font-medium text-judo-navy">
                            {formatJudokaFullName(j)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {j.displayId}
                            {j.weightKg ? ` · ${j.weightKg} kg` : ''}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button variant="accent" size="lg" disabled={busy} onClick={() => void save()}>
              <Save className="h-4 w-4" />
              {busy ? 'Enregistrement…' : editingId ? 'Mettre à jour l’équipe' : 'Enregistrer l’équipe'}
            </Button>
            {editingId && (
              <Button variant="outline" disabled={busy} onClick={resetForm}>
                Annuler
              </Button>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-emerald-700">{message}</p>}
        </div>

        <div className="rounded-xl border bg-white/75 p-5 space-y-3 max-w-3xl">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-judo-navy" />
            <Label className="text-base">Équipes enregistrées</Label>
          </div>
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune équipe. Enregistrez un club avec ses judokas pour le tirage par équipe.
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
                      title="Modifier"
                      disabled={busy}
                      onClick={() => loadTeam(t)}
                    >
                      <Pencil className="h-4 w-4" />
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
    </AppShell>
  )
}
