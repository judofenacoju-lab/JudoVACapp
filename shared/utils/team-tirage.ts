import type { Judoka, Sex } from '@shared/types/judoka'
import type { TeamWeightClassRange } from '@shared/types/settings'
import type { Team, TeamCategoryLineup } from '@shared/types/teams'
import { teamDisplayName } from '@shared/types/teams'
import {
  createEmptyCombatSession,
  distributeCombatsAcrossTatamis,
  hasAtLeastOneJudoka,
  type CombatFighterRef,
  type CombatSession,
  type CombatStatus,
  type ManagedCombat,
  type TeamMatch
} from '@shared/types/combats'
import { formatJudokaFullName } from '@shared/utils/judoka'
import { createWeightClassId, suggestWeightClassLabel } from '@shared/utils/tirage'

export interface TeamTirageResult {
  generatedAt: string
  teamCount: number
  matchCount: number
  boutCount: number
  session: CombatSession
}

export function normalizeTeamWeightClasses(
  classes: Array<Partial<TeamWeightClassRange> | TeamWeightClassRange>
): TeamWeightClassRange[] {
  return classes
    .map((c) => {
      const minKg = Number(c.minKg)
      const maxKg = Number(c.maxKg)
      const sex: Sex | null = c.sex === 'F' ? 'F' : c.sex === 'M' ? 'M' : null
      const label = String(c.label ?? '').trim() || suggestWeightClassLabel(maxKg)
      return {
        id: String(c.id ?? '').trim() || createWeightClassId(),
        label,
        minKg: Number.isFinite(minKg) ? Math.min(minKg, maxKg) : 0,
        maxKg: Number.isFinite(maxKg) ? Math.max(minKg, maxKg) : 0,
        sex: sex ?? 'M'
      }
    })
    .filter(
      (c) =>
        (c.sex === 'M' || c.sex === 'F') &&
        Number.isFinite(c.minKg) &&
        Number.isFinite(c.maxKg) &&
        c.maxKg > 0 &&
        c.label
    )
    .sort(
      (a, b) =>
        a.sex.localeCompare(b.sex) || a.maxKg - b.maxKg || a.minKg - b.minKg || a.label.localeCompare(b.label, 'fr')
    )
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return Math.max(2, p)
}

function judokaAge(j: Judoka): number {
  if (j.age != null && Number.isFinite(j.age)) return Math.max(0, Math.floor(j.age))
  return 0
}

function judokaWeight(j: Judoka): number {
  const n = Number(j.weightKg)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function toFighter(j: Judoka, category: string): CombatFighterRef {
  return {
    id: j.id,
    displayId: j.displayId,
    name: formatJudokaFullName(j),
    club: j.club?.trim() || '',
    age: judokaAge(j),
    sex: j.sex,
    category,
    weightKg: judokaWeight(j)
  }
}

function membersOf(team: Team, byId: Map<string, Judoka>): Judoka[] {
  return team.judokaIds.map((id) => byId.get(id)).filter((j): j is Judoka => Boolean(j))
}

function matchesWeightClass(j: Judoka, wc: TeamWeightClassRange): boolean {
  if (j.sex !== wc.sex) return false
  const w = judokaWeight(j)
  if (w <= 0) return false
  return w >= wc.minKg - 1e-9 && w <= wc.maxKg + 1e-9
}

function lineupForClass(team: Team, wc: TeamWeightClassRange): TeamCategoryLineup | undefined {
  return (team.lineups ?? []).find((l) => {
    if (l.sex !== wc.sex) return false
    if (l.weightLabel.trim().toLowerCase() === wc.label.trim().toLowerCase()) return true
    return Math.abs(l.minKg - wc.minKg) < 1e-6 && Math.abs(l.maxKg - wc.maxKg) < 1e-6
  })
}

function sortJudokas(a: Judoka, b: Judoka): number {
  const w = judokaWeight(a) - judokaWeight(b)
  if (w !== 0) return w
  return formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr')
}

function pickPrincipalAndSub(
  team: Team,
  wc: TeamWeightClassRange,
  byId: Map<string, Judoka>
): { principal: Judoka | null; substitute: Judoka | null } {
  const candidates = membersOf(team, byId)
    .filter((j) => matchesWeightClass(j, wc))
    .slice()
    .sort(sortJudokas)
  const lineup = lineupForClass(team, wc)
  let principal: Judoka | null = null
  let substitute: Judoka | null = null
  if (lineup?.principalId) {
    principal = candidates.find((j) => j.id === lineup.principalId) ?? null
  }
  if (!principal) principal = candidates[0] ?? null
  if (lineup?.substituteId && lineup.substituteId !== principal?.id) {
    substitute = candidates.find((j) => j.id === lineup.substituteId) ?? null
  }
  if (!substitute) {
    substitute = candidates.find((j) => j.id !== principal?.id) ?? null
  }
  return { principal, substitute }
}

function boutStatus(top: CombatFighterRef | null, bottom: CombatFighterRef | null): {
  status: CombatStatus
  winnerId: string | null
  bye: boolean
} {
  if (top && bottom) return { status: 'ready', winnerId: null, bye: false }
  if (top || bottom) {
    return { status: 'completed', winnerId: top?.id ?? bottom?.id ?? null, bye: true }
  }
  return { status: 'pending', winnerId: null, bye: false }
}

export function buildTeamBouts(
  match: TeamMatch,
  home: Team,
  away: Team,
  byId: Map<string, Judoka>,
  weightClasses: TeamWeightClassRange[],
  now: string
): ManagedCombat[] {
  const classes = normalizeTeamWeightClasses(weightClasses)
  const combats: ManagedCombat[] = []
  const homeLabel = teamDisplayName(home)
  const awayLabel = teamDisplayName(away)
  const teamMatchLabel = `${homeLabel} vs ${awayLabel}`

  classes.forEach((wc, index) => {
    const homePick = pickPrincipalAndSub(home, wc, byId)
    const awayPick = pickPrincipalAndSub(away, wc, byId)
    const top = homePick.principal ? toFighter(homePick.principal, wc.label) : null
    const bottom = awayPick.principal ? toFighter(awayPick.principal, wc.label) : null
    if (!top && !bottom) return
    const topSubstitute = homePick.substitute ? toFighter(homePick.substitute, wc.label) : null
    const bottomSubstitute = awayPick.substitute ? toFighter(awayPick.substitute, wc.label) : null
    const { status, winnerId, bye } = boutStatus(top, bottom)
    const sexLabel = wc.sex === 'F' ? 'Filles' : 'Garçons'
    combats.push({
      id: `${match.id}::bout-${wc.sex}-${wc.id}`,
      matchId: `bout-${wc.id}`,
      label: `Combat ${index + 1}`,
      round: match.round,
      matchIndex: index,
      poolKey: `${match.id}|${wc.sex}|${wc.id}`,
      poolLabel: `${sexLabel} · ${wc.label}`,
      sex: wc.sex,
      category: wc.label,
      weightLabel: wc.label,
      top,
      bottom,
      topSubstitute,
      bottomSubstitute,
      bye,
      tatamiId: null,
      orderOnTatami: 0,
      status,
      winnerId,
      feedsInto: null,
      updatedAt: now,
      kind: 'team',
      teamMatchId: match.id,
      teamMatchLabel,
      homeClub: home.club,
      awayClub: away.club
    })
  })

  return combats.map((c, i) => ({ ...c, label: `Combat ${i + 1}`, matchIndex: i }))
}

export function generateTeamTirage(
  teams: Team[],
  judokas: Judoka[],
  weightClasses: TeamWeightClassRange[]
): TeamTirageResult {
  const now = new Date().toISOString()
  const classes = normalizeTeamWeightClasses(weightClasses)
  const registered = teams.filter((t) => t.club.trim() && t.judokaIds.length > 0)
  const allowed = new Set(registered.flatMap((t) => t.judokaIds))
  const byId = new Map(judokas.filter((j) => allowed.has(j.id)).map((j) => [j.id, j]))
  const eligible = registered.filter((t) => membersOf(t, byId).length > 0)

  const session = createEmptyCombatSession()
  session.kind = 'team'
  session.sourceTirageAt = now
  session.updatedAt = now

  if (eligible.length < 2 || classes.length === 0) {
    session.teamMatches = []
    session.combats = []
    return {
      generatedAt: now,
      teamCount: eligible.length,
      matchCount: 0,
      boutCount: 0,
      session
    }
  }

  const shuffled = shuffle(eligible)
  const size = nextPow2(shuffled.length)
  const slots: Array<Team | null> = [...shuffled]
  while (slots.length < size) slots.push(null)

  const rounds = Math.round(Math.log2(size))
  const matches: TeamMatch[] = []
  const byRound: TeamMatch[][] = []

  for (let r = 0; r < rounds; r++) {
    const count = size / 2 ** (r + 1)
    const row: TeamMatch[] = []
    for (let i = 0; i < count; i++) {
      const id = `tm-r${r}-m${i}`
      row.push({
        id,
        label: r === rounds - 1 ? 'Finale' : r === rounds - 2 ? `Demi ${i + 1}` : `Rencontre ${i + 1}`,
        round: r,
        matchIndex: i,
        homeTeamId: null,
        awayTeamId: null,
        homeClub: 'À déterminer',
        awayClub: 'À déterminer',
        winnerTeamId: null,
        feedsInto: null
      })
    }
    byRound.push(row)
    matches.push(...row)
  }

  for (let r = 0; r < rounds - 1; r++) {
    const row = byRound[r]!
    const next = byRound[r + 1]!
    for (let i = 0; i < row.length; i++) {
      row[i]!.feedsInto = {
        teamMatchId: next[Math.floor(i / 2)]!.id,
        slot: i % 2 === 0 ? 'home' : 'away'
      }
    }
  }

  const first = byRound[0]!
  for (let i = 0; i < first.length; i++) {
    const home = slots[i * 2] ?? null
    const away = slots[i * 2 + 1] ?? null
    first[i]!.homeTeamId = home?.id ?? null
    first[i]!.awayTeamId = away?.id ?? null
    first[i]!.homeClub = home ? teamDisplayName(home) : 'Bye'
    first[i]!.awayClub = away ? teamDisplayName(away) : 'Bye'
    if (home && !away) first[i]!.winnerTeamId = home.id
    if (away && !home) first[i]!.winnerTeamId = away.id
  }

  const teamById = new Map(eligible.map((t) => [t.id, t]))
  const combats: ManagedCombat[] = []
  for (const m of first) {
    if (!m.homeTeamId || !m.awayTeamId) continue
    const home = teamById.get(m.homeTeamId)
    const away = teamById.get(m.awayTeamId)
    if (!home || !away) continue
    combats.push(...buildTeamBouts(m, home, away, byId, classes, now))
  }

  session.teamMatches = matches
  session.combats = combats
  return {
    generatedAt: now,
    teamCount: eligible.length,
    matchCount: first.filter((m) => m.homeTeamId && m.awayTeamId).length,
    boutCount: combats.filter(hasAtLeastOneJudoka).length,
    session: resolveTeamMatches(session, { teams: eligible, judokas: [...byId.values()], weightClasses: classes })
  }
}

export function mergeTeamTirageIntoCombatSession(
  existing: CombatSession | null,
  generated: CombatSession
): CombatSession {
  const merged: CombatSession = {
    ...generated,
    id: existing?.id ?? generated.id,
    tatamis: existing?.tatamis?.length ? existing.tatamis.map((t) => ({ ...t })) : [],
    confirmedAt: null,
    kind: 'team',
    updatedAt: new Date().toISOString()
  }
  if (!merged.tatamis.length) return merged
  return distributeCombatsAcrossTatamis(merged)
}

export function teamMatchScore(
  session: CombatSession,
  teamMatchId: string
): { home: number; away: number } {
  let home = 0
  let away = 0
  for (const c of session.combats) {
    if (c.teamMatchId !== teamMatchId || c.status !== 'completed' || !c.winnerId) continue
    if (c.top?.id === c.winnerId) home += 1
    else if (c.bottom?.id === c.winnerId) away += 1
  }
  return { home, away }
}

export interface TeamResolveCtx {
  teams: Team[]
  judokas: Judoka[]
  weightClasses: TeamWeightClassRange[]
}

function fillSlot(match: TeamMatch, slot: 'home' | 'away', team: Team): void {
  if (slot === 'home') {
    match.homeTeamId = team.id
    match.homeClub = teamDisplayName(team)
  } else {
    match.awayTeamId = team.id
    match.awayClub = teamDisplayName(team)
  }
}

/**
 * Après un vainqueur de combat : clôture la rencontre, avance l’équipe, crée les combats suivants.
 */
export function resolveTeamMatches(
  session: CombatSession,
  ctx?: TeamResolveCtx
): CombatSession {
  if (session.kind !== 'team' || !session.teamMatches?.length) return session
  const now = new Date().toISOString()
  const matches = session.teamMatches.map((m) => ({ ...m }))
  let combats = session.combats.map((c) => ({ ...c }))
  const teamById = new Map((ctx?.teams ?? []).map((t) => [t.id, t]))
  const allowed = new Set((ctx?.teams ?? []).flatMap((t) => t.judokaIds))
  const byId = new Map(
    (ctx?.judokas ?? []).filter((j) => allowed.size === 0 || allowed.has(j.id)).map((j) => [j.id, j])
  )
  const weightClasses = normalizeTeamWeightClasses(ctx?.weightClasses ?? [])

  let changed = true
  while (changed) {
    changed = false
    for (const match of matches) {
      if (match.winnerTeamId) {
        if (match.feedsInto) {
          const next = matches.find((m) => m.id === match.feedsInto!.teamMatchId)
          const winner = teamById.get(match.winnerTeamId)
          if (next && winner) {
            const slot = match.feedsInto.slot
            const currentId = slot === 'home' ? next.homeTeamId : next.awayTeamId
            if (currentId !== winner.id) {
              fillSlot(next, slot, winner)
              changed = true
            }
          }
        }
        continue
      }

      if (match.homeTeamId && !match.awayTeamId) {
        match.winnerTeamId = match.homeTeamId
        changed = true
        continue
      }
      if (match.awayTeamId && !match.homeTeamId) {
        match.winnerTeamId = match.awayTeamId
        changed = true
        continue
      }

      const bouts = combats.filter((c) => c.teamMatchId === match.id)
      if (bouts.length === 0) continue
      if (bouts.some((c) => c.status !== 'completed')) continue
      const score = teamMatchScore({ ...session, combats }, match.id)
      if (score.home > score.away && match.homeTeamId) {
        match.winnerTeamId = match.homeTeamId
        changed = true
      } else if (score.away > score.home && match.awayTeamId) {
        match.winnerTeamId = match.awayTeamId
        changed = true
      } else if (match.homeTeamId) {
        match.winnerTeamId = match.homeTeamId
        changed = true
      }
    }

    for (const match of matches) {
      if (!match.homeTeamId || !match.awayTeamId) continue
      if (combats.some((c) => c.teamMatchId === match.id)) continue
      const home = teamById.get(match.homeTeamId)
      const away = teamById.get(match.awayTeamId)
      if (!home || !away || weightClasses.length === 0) continue
      const created = buildTeamBouts(match, home, away, byId, weightClasses, now)
      if (created.length === 0) continue
      combats = [...combats, ...created]
      changed = true
    }
  }

  const next: CombatSession = {
    ...session,
    teamMatches: matches,
    combats,
    updatedAt: now
  }
  if (next.tatamis.length > 0) return distributeCombatsAcrossTatamis(next)
  return next
}
