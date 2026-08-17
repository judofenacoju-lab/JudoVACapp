import type { Sex } from '@shared/types/judoka'

/** Composition d’une catégorie (poids × sexe) : titulaire et remplaçant. */
export interface TeamCategoryLineup {
  id: string
  sex: Sex
  weightLabel: string
  minKg: number
  maxKg: number
  principalId: string | null
  substituteId: string | null
}

/** Équipe = un club + les judokas retenus pour les combats par équipe. */
export interface Team {
  id: string
  club: string
  name: string
  judokaIds: string[]
  /** Titulaires / remplaçants par catégorie de poids. */
  lineups: TeamCategoryLineup[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export function createTeamId(): string {
  return `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function teamDisplayName(team: Team): string {
  const name = team.name.trim()
  const club = team.club.trim()
  if (name && name.toLowerCase() !== club.toLowerCase()) return `${name} (${club})`
  return club || name || 'Équipe'
}

export function createLineupId(): string {
  return `lu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeLineups(raw: unknown, memberIds: string[] = []): TeamCategoryLineup[] {
  if (!Array.isArray(raw)) return []
  const allowed = new Set(memberIds)
  const out: TeamCategoryLineup[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Partial<TeamCategoryLineup>
    const sex: Sex | null = r.sex === 'F' ? 'F' : r.sex === 'M' ? 'M' : null
    if (!sex) continue
    const weightLabel = String(r.weightLabel ?? '').trim()
    const minKg = Number(r.minKg)
    const maxKg = Number(r.maxKg)
    if (!weightLabel || !Number.isFinite(minKg) || !Number.isFinite(maxKg) || maxKg <= 0) continue
    let principalId = String(r.principalId ?? '').trim() || null
    let substituteId = String(r.substituteId ?? '').trim() || null
    if (principalId && allowed.size > 0 && !allowed.has(principalId)) principalId = null
    if (substituteId && allowed.size > 0 && !allowed.has(substituteId)) substituteId = null
    if (substituteId && substituteId === principalId) substituteId = null
    out.push({
      id: String(r.id ?? '').trim() || createLineupId(),
      sex,
      weightLabel,
      minKg: Math.min(minKg, maxKg),
      maxKg: Math.max(minKg, maxKg),
      principalId,
      substituteId
    })
  }
  return out
}

/** Ne conserve titulaire / remplaçant que s’ils correspondent à la catégorie (sexe + poids). */
export function sanitizeLineupsForClasses(
  team: Team,
  members: Array<{ id: string; sex: string; weightKg?: number | null }>,
  classes: Array<{ sex: string; label: string; minKg: number; maxKg: number }>
): Team {
  const byId = new Map(members.map((j) => [j.id, j]))
  const inClass = (
    id: string | null,
    wc: { sex: string; minKg: number; maxKg: number }
  ): string | null => {
    if (!id) return null
    const j = byId.get(id)
    if (!j) {
      return team.judokaIds.includes(id) ? id : null
    }
    if (j.sex !== wc.sex) return null
    const w = Number(j.weightKg)
    if (!Number.isFinite(w) || w <= 0) return null
    if (w < wc.minKg - 1e-9 || w > wc.maxKg + 1e-9) return null
    return id
  }
  const lineups = (team.lineups ?? []).map((l) => {
    const wc =
      classes.find(
        (c) =>
          c.sex === l.sex &&
          (c.label.trim().toLowerCase() === l.weightLabel.trim().toLowerCase() ||
            (Math.abs(c.minKg - l.minKg) < 1e-6 && Math.abs(c.maxKg - l.maxKg) < 1e-6))
      ) ?? l
    let principalId = inClass(l.principalId, wc)
    let substituteId = inClass(l.substituteId, wc)
    if (substituteId && substituteId === principalId) substituteId = null
    return { ...l, principalId, substituteId }
  })
  return { ...team, lineups: normalizeLineups(lineups, team.judokaIds) }
}

export function upsertTeamLineup(
  team: Team,
  wc: { sex: Sex; label: string; minKg: number; maxKg: number },
  patch: { principalId?: string | null; substituteId?: string | null }
): Team {
  const lineups = [...(team.lineups ?? [])]
  const idx = lineups.findIndex((l) => {
    if (l.sex !== wc.sex) return false
    if (l.weightLabel.trim().toLowerCase() === wc.label.trim().toLowerCase()) return true
    return Math.abs(l.minKg - wc.minKg) < 1e-6 && Math.abs(l.maxKg - wc.maxKg) < 1e-6
  })
  const current: TeamCategoryLineup =
    idx >= 0
      ? { ...lineups[idx]! }
      : {
          id: createLineupId(),
          sex: wc.sex,
          weightLabel: wc.label,
          minKg: wc.minKg,
          maxKg: wc.maxKg,
          principalId: null,
          substituteId: null
        }
  if (patch.principalId !== undefined) current.principalId = patch.principalId
  if (patch.substituteId !== undefined) current.substituteId = patch.substituteId
  if (current.substituteId && current.substituteId === current.principalId) {
    current.substituteId = null
  }
  if (idx >= 0) lineups[idx] = current
  else lineups.push(current)
  return {
    ...team,
    lineups: normalizeLineups(lineups, team.judokaIds),
    updatedAt: new Date().toISOString()
  }
}

export function teamMemberIdSet(teams: Team[]): Set<string> {
  const ids = new Set<string>()
  for (const t of teams) {
    for (const id of t.judokaIds) ids.add(id)
  }
  return ids
}

export function normalizeTeams(raw: unknown): Team[] {
  if (!Array.isArray(raw)) return []
  const out: Team[] = []
  const seenClubs = new Set<string>()
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Partial<Team>
    const club = String(r.club ?? '').trim()
    if (!club) continue
    const key = club.toLowerCase()
    if (seenClubs.has(key)) continue
    seenClubs.add(key)
    const ids = Array.isArray(r.judokaIds)
      ? [...new Set(r.judokaIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
      : []
    const now = new Date().toISOString()
    out.push({
      id: String(r.id ?? '').trim() || createTeamId(),
      club,
      name: String(r.name ?? '').trim() || club,
      judokaIds: ids,
      lineups: normalizeLineups(r.lineups, ids),
      createdBy: String(r.createdBy ?? '').trim() || 'inconnu',
      createdAt: String(r.createdAt ?? now),
      updatedAt: String(r.updatedAt ?? now)
    })
  }
  return out.sort((a, b) => a.club.localeCompare(b.club, 'fr'))
}
