import type { Judoka, Sex } from '@shared/types/judoka'
import type { CategoryAgeRange } from '@shared/types/settings'
import type { Team } from '@shared/types/teams'
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
import { formatJudokaFullName, resolveJudokaCategory } from '@shared/utils/judoka'

export interface TeamTirageResult {
  generatedAt: string
  teamCount: number
  matchCount: number
  boutCount: number
  session: CombatSession
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

function toFighter(j: Judoka, category: string, ranges: CategoryAgeRange[]): CombatFighterRef {
  return {
    id: j.id,
    displayId: j.displayId,
    name: formatJudokaFullName(j),
    club: j.club?.trim() || '',
    age: judokaAge(j),
    sex: j.sex,
    category: resolveJudokaCategory(j.birthDate, j.category, ranges) || category,
    weightKg: judokaWeight(j)
  }
}

function membersOf(team: Team, byId: Map<string, Judoka>): Judoka[] {
  return team.judokaIds.map((id) => byId.get(id)).filter((j): j is Judoka => Boolean(j))
}

function groupKey(j: Judoka, ranges: CategoryAgeRange[]): string {
  const cat = resolveJudokaCategory(j.birthDate, j.category, ranges) || 'Sans catégorie'
  return `${j.sex}|${cat}`
}

function parseKey(key: string): { sex: Sex; category: string } {
  const i = key.indexOf('|')
  const sex = (key.slice(0, i) === 'F' ? 'F' : 'M') as Sex
  return { sex, category: key.slice(i + 1) || 'Sans catégorie' }
}

function sortJudokas(a: Judoka, b: Judoka): number {
  const w = judokaWeight(a) - judokaWeight(b)
  if (w !== 0) return w
  return formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr')
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
  ranges: CategoryAgeRange[],
  now: string
): ManagedCombat[] {
  const homeMembers = membersOf(home, byId)
  const awayMembers = membersOf(away, byId)
  const groups = new Map<string, { home: Judoka[]; away: Judoka[] }>()
  for (const j of homeMembers) {
    const key = groupKey(j, ranges)
    const g = groups.get(key) ?? { home: [], away: [] }
    g.home.push(j)
    groups.set(key, g)
  }
  for (const j of awayMembers) {
    const key = groupKey(j, ranges)
    const g = groups.get(key) ?? { home: [], away: [] }
    g.away.push(j)
    groups.set(key, g)
  }

  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'fr'))
  const combats: ManagedCombat[] = []
  let index = 0
  const homeLabel = teamDisplayName(home)
  const awayLabel = teamDisplayName(away)
  const teamMatchLabel = `${homeLabel} vs ${awayLabel}`

  for (const key of keys) {
    const { sex, category } = parseKey(key)
    const g = groups.get(key)!
    const homeList = g.home.slice().sort(sortJudokas)
    const awayList = g.away.slice().sort(sortJudokas)
    const n = Math.max(homeList.length, awayList.length)
    for (let i = 0; i < n; i++) {
      const hj = homeList[i]
      const aj = awayList[i]
      const top = hj ? toFighter(hj, category, ranges) : null
      const bottom = aj ? toFighter(aj, category, ranges) : null
      const { status, winnerId, bye } = boutStatus(top, bottom)
      const sexLabel = sex === 'F' ? 'Filles' : 'Garçons'
      index += 1
      combats.push({
        id: `${match.id}::bout-${index}`,
        matchId: `bout-${index}`,
        label: `Combat ${index}`,
        round: match.round,
        matchIndex: index - 1,
        poolKey: `${match.id}|${key}`,
        poolLabel: `${sexLabel} · ${category}`,
        sex,
        category,
        weightLabel: '',
        top,
        bottom,
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
    }
  }
  return combats
}

export function generateTeamTirage(
  teams: Team[],
  judokas: Judoka[],
  ranges: CategoryAgeRange[]
): TeamTirageResult {
  const now = new Date().toISOString()
  const eligible = teams.filter((t) => t.club.trim() && t.judokaIds.length > 0)
  const session = createEmptyCombatSession()
  session.kind = 'team'
  session.sourceTirageAt = now
  session.updatedAt = now

  if (eligible.length < 2) {
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

  const byId = new Map(judokas.map((j) => [j.id, j]))
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
    combats.push(...buildTeamBouts(m, home, away, byId, ranges, now))
  }

  session.teamMatches = matches
  session.combats = combats
  return {
    generatedAt: now,
    teamCount: eligible.length,
    matchCount: first.filter((m) => m.homeTeamId && m.awayTeamId).length,
    boutCount: combats.filter(hasAtLeastOneJudoka).length,
    session: resolveTeamMatches(session, { teams: eligible, judokas, ranges })
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

interface TeamResolveCtx {
  teams: Team[]
  judokas: Judoka[]
  ranges: CategoryAgeRange[]
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
  const byId = new Map((ctx?.judokas ?? []).map((j) => [j.id, j]))
  const ranges = ctx?.ranges ?? []

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
      if (!home || !away || ranges.length === 0) continue
      const created = buildTeamBouts(match, home, away, byId, ranges, now)
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
