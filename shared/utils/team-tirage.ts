import type { Judoka, Sex } from '@shared/types/judoka'
import type { TeamWeightClassRange } from '@shared/types/settings'
import {
  teamDisplayName,
  type Team,
  type TeamCategoryLineup
} from '@shared/types/teams'
import {
  createEmptyCombatSession,
  distributeCombatsAcrossTatamis,
  hasAtLeastOneJudoka,
  type CombatFighterRef,
  type CombatSession,
  type CombatStatus,
  type ManagedCombat,
  type TeamMatch,
  type TeamMatchDecidedBy,
  type TeamWinMethod
} from '@shared/types/combats'
import { formatJudokaFullName } from '@shared/utils/judoka'
import { phaseForRound } from '@shared/utils/combat-phase'
import {
  createWeightClassId,
  suggestWeightClassLabel,
  type BracketMatch,
  type BracketTree,
  type TirageFighter
} from '@shared/utils/tirage'

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

/** Filtre de sexe du tirage par équipe. */
export type TeamSexFilter = 'all' | 'M' | 'F'

export function isTeamSexFilter(value: unknown): value is TeamSexFilter {
  return value === 'all' || value === 'M' || value === 'F'
}

export function filterTeamWeightClasses(
  classes: TeamWeightClassRange[],
  sex: TeamSexFilter | undefined
): TeamWeightClassRange[] {
  const all = normalizeTeamWeightClasses(classes)
  if (sex === 'M' || sex === 'F') return all.filter((c) => c.sex === sex)
  return all
}

export function inferTeamSexFilter(classes: TeamWeightClassRange[]): TeamSexFilter {
  const sexes = new Set(normalizeTeamWeightClasses(classes).map((c) => c.sex))
  if (sexes.size === 1) {
    const only = [...sexes][0]
    if (only === 'M' || only === 'F') return only
  }
  return 'all'
}

/** Club inscrit pour un sexe : judoka de ce sexe dans l’effectif, ou composition (titulaire / remplaçant). */
export function teamAttachedToSex(
  team: Team,
  judokasById: Map<string, Pick<Judoka, 'sex'>>,
  sex: 'M' | 'F'
): boolean {
  for (const id of team.judokaIds) {
    if (judokasById.get(id)?.sex === sex) return true
  }
  return (team.lineups ?? []).some(
    (l) => l.sex === sex && Boolean(l.principalId || l.substituteId)
  )
}

/** Clubs qui participent au tirage : tous si « Toutes », sinon seulement ceux du sexe choisi. */
export function filterTeamsForTeamTirage(
  teams: Team[],
  judokas: Array<Pick<Judoka, 'id' | 'sex'>>,
  sex: TeamSexFilter | undefined
): Team[] {
  const registered = teams.filter((t) => t.club.trim())
  if (sex !== 'M' && sex !== 'F') return registered
  const byId = new Map(judokas.map((j) => [j.id, j]))
  return registered.filter((t) => teamAttachedToSex(t, byId, sex))
}

export function matchTeamWeightClass(
  j: Judoka,
  classes: TeamWeightClassRange[]
): TeamWeightClassRange | null {
  const w = Number(j.weightKg)
  if (!Number.isFinite(w) || w <= 0) return null
  for (const c of normalizeTeamWeightClasses(classes)) {
    if (j.sex === c.sex && w >= c.minKg - 1e-9 && w <= c.maxKg + 1e-9) return c
  }
  return null
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
  const seen = new Set<string>()
  const out: Judoka[] = []
  for (const id of team.judokaIds) {
    const j = byId.get(id)
    if (!j || seen.has(j.id)) continue
    seen.add(j.id)
    out.push(j)
  }
  return out
}

function judokasIndexedForTeams(teams: Team[], judokas: Judoka[]): Map<string, Judoka> {
  const allowed = new Set(teams.flatMap((t) => t.judokaIds))
  return new Map(judokas.filter((j) => allowed.has(j.id)).map((j) => [j.id, j]))
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

/** Ippon = 10 pts techniques ; Waza-ari = 1 pt (règlement Judo Vacances). */
export const TEAM_TECH_IPPON = 10
export const TEAM_TECH_WAZA_ARI = 1

export function technicalPointsFor(method: TeamWinMethod | undefined): number {
  if (method === 'ippon' || method === 'fusen') return TEAM_TECH_IPPON
  if (method === 'waza_ari') return TEAM_TECH_WAZA_ARI
  return 0
}

/** Catégories officielles Judo Vacances (garçons par défaut). */
export function judoVacancesWeightClasses(sex: 'M' | 'F' = 'M'): TeamWeightClassRange[] {
  const caps = [
    { label: '-60 kg', maxKg: 60 },
    { label: '-66 kg', maxKg: 66 },
    { label: '-73 kg', maxKg: 73 },
    { label: '-81 kg', maxKg: 81 },
    { label: '-90 kg', maxKg: 90 }
  ]
  let prev = 0
  const rows: TeamWeightClassRange[] = caps.map((c) => {
    const row: TeamWeightClassRange = {
      id: createWeightClassId(),
      label: c.label,
      minKg: prev,
      maxKg: c.maxKg,
      sex
    }
    prev = c.maxKg
    return row
  })
  rows.push({
    id: createWeightClassId(),
    label: '+90 kg',
    minKg: 90,
    maxKg: 250,
    sex
  })
  return rows
}

function boutStatus(top: CombatFighterRef | null, bottom: CombatFighterRef | null): {
  status: CombatStatus
  winnerId: string | null
  bye: boolean
  winMethod?: TeamWinMethod
} {
  if (top && bottom) return { status: 'ready', winnerId: null, bye: false }
  if (top || bottom) {
    return { status: 'ready', winnerId: null, bye: true }
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
    const { status, winnerId, bye, winMethod } = boutStatus(top, bottom)
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
      winMethod,
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

function buildPlayoffBouts(
  match: TeamMatch,
  home: Team,
  away: Team,
  byId: Map<string, Judoka>,
  weightClasses: TeamWeightClassRange[],
  now: string
): ManagedCombat[] {
  return buildTeamBouts(match, home, away, byId, weightClasses, now).map((c, i) => {
    const sexLabel = c.sex === 'F' ? 'Filles' : 'Garçons'
    return {
      ...c,
      id: `${match.id}::playoff-${c.sex}-${c.matchId}`,
      matchId: `playoff-${c.matchId}`,
      label: `Départage ${i + 1}`,
      poolKey: `${c.poolKey}|playoff`,
      poolLabel: `Départage · ${sexLabel} · ${c.weightLabel}`,
      goldenScore: true,
      updatedAt: now
    }
  })
}

function weightClassForCombat(
  combat: ManagedCombat,
  classes: TeamWeightClassRange[]
): TeamWeightClassRange | undefined {
  const parsed = parsePoolLabel(combat.poolLabel || '')
  const sex = combat.sex || parsed.sex
  const label = (combat.weightLabel || combat.category || parsed.weightLabel).trim().toLowerCase()
  return classes.find((wc) => wc.sex === sex && wc.label.trim().toLowerCase() === label)
}

function otherFighterForClub(
  combat: ManagedCombat,
  slot: 'top' | 'bottom',
  teams: Team[],
  byId: Map<string, Judoka>,
  wc: TeamWeightClassRange | undefined
): CombatFighterRef | null {
  const current = slot === 'top' ? combat.top : combat.bottom
  const club = (slot === 'top' ? combat.homeClub : combat.awayClub) || current?.club || ''
  const team = findTeamByClub(teams, club)
  if (!team || !current) return null
  if (wc) {
    const pick = pickPrincipalAndSub(team, wc, byId)
    const other = [pick.principal, pick.substitute].find((j) => j && j.id !== current.id) ?? null
    if (other) return toFighter(other, wc.label || combat.category)
  }
  const label = (combat.weightLabel || combat.category).trim().toLowerCase()
  const lineup = (team.lineups ?? []).find(
    (l) => l.sex === combat.sex && l.weightLabel.trim().toLowerCase() === label
  )
  const otherId =
    current.id === lineup?.principalId
      ? lineup?.substituteId
      : current.id === lineup?.substituteId
        ? lineup?.principalId
        : lineup?.substituteId && lineup.substituteId !== current.id
          ? lineup.substituteId
          : lineup?.principalId
  if (!otherId || otherId === current.id) return null
  const j = byId.get(otherId)
  return j ? toFighter(j, combat.category) : null
}

/** Complète les remplaçants manquants (line-up du club × catégorie) pour permettre la permutation. */
export function attachTeamCombatSubstitutes(
  session: CombatSession,
  teams: Team[],
  judokas: Judoka[],
  weightClasses: TeamWeightClassRange[]
): CombatSession {
  if (session.kind !== 'team') return session
  const classes = normalizeTeamWeightClasses(weightClasses)
  const byId = judokasIndexedForTeams(teams, judokas)
  let changed = false
  const combats = session.combats.map((c) => {
    const wc = weightClassForCombat(c, classes)
    const topSubstitute = c.topSubstitute ?? otherFighterForClub(c, 'top', teams, byId, wc)
    const bottomSubstitute = c.bottomSubstitute ?? otherFighterForClub(c, 'bottom', teams, byId, wc)
    if (
      (topSubstitute?.id ?? null) === (c.topSubstitute?.id ?? null) &&
      (bottomSubstitute?.id ?? null) === (c.bottomSubstitute?.id ?? null)
    ) {
      return c
    }
    changed = true
    return { ...c, topSubstitute, bottomSubstitute }
  })
  return changed ? { ...session, combats } : session
}

export function generateTeamTirage(
  teams: Team[],
  judokas: Judoka[],
  weightClasses: TeamWeightClassRange[],
  sexFilter?: TeamSexFilter
): TeamTirageResult {
  const now = new Date().toISOString()
  const classes = normalizeTeamWeightClasses(weightClasses)
  const registered = teams.filter((t) => t.club.trim())
  const eligible = filterTeamsForTeamTirage(registered, judokas, sexFilter)
  const byId = judokasIndexedForTeams(eligible, judokas)

  const session = createEmptyCombatSession()
  session.kind = 'team'
  session.sourceTirageAt = now
  session.updatedAt = now
  session.teamSexFilter =
    sexFilter === 'M' || sexFilter === 'F' ? sexFilter : inferTeamSexFilter(classes)

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

export interface TeamMatchScoreBreakdown {
  /** Alias de homeWins (compat affichage). */
  home: number
  /** Alias de awayWins (compat affichage). */
  away: number
  homeWins: number
  awayWins: number
  homeTech: number
  awayTech: number
  regularComplete: boolean
  goldenScore: ManagedCombat | null
  playoff: ManagedCombat[]
  playoffComplete: boolean
  decidedBy: TeamMatchDecidedBy | null
  winnerSlot: 'home' | 'away' | null
}

function addBoutToTotals(
  c: ManagedCombat,
  acc: { homeWins: number; awayWins: number; homeTech: number; awayTech: number }
): void {
  if (c.status !== 'completed' || c.winMethod === 'draw' || !c.winnerId) return
  const tech = technicalPointsFor(c.winMethod)
  if (c.top?.id === c.winnerId) {
    acc.homeWins += 1
    acc.homeTech += tech
  } else if (c.bottom?.id === c.winnerId) {
    acc.awayWins += 1
    acc.awayTech += tech
  }
}

export function teamMatchScore(session: CombatSession, teamMatchId: string): TeamMatchScoreBreakdown {
  const totals = { homeWins: 0, awayWins: 0, homeTech: 0, awayTech: 0 }
  const bouts = session.combats.filter((c) => c.teamMatchId === teamMatchId)
  const regular = bouts.filter((c) => !c.goldenScore)
  const playoff = bouts.filter((c) => c.goldenScore)
  const goldenScore = playoff[0] ?? null
  const regularComplete = regular.length > 0 && regular.every((c) => c.status === 'completed')
  const playoffComplete = playoff.length > 0 && playoff.every((c) => c.status === 'completed')

  for (const c of regular) addBoutToTotals(c, totals)

  let decidedBy: TeamMatchDecidedBy | null = null
  let winnerSlot: 'home' | 'away' | null = null
  if (regularComplete) {
    if (totals.homeWins > totals.awayWins) {
      winnerSlot = 'home'
      decidedBy = 'wins'
    } else if (totals.awayWins > totals.homeWins) {
      winnerSlot = 'away'
      decidedBy = 'wins'
    } else if (totals.homeTech > totals.awayTech) {
      winnerSlot = 'home'
      decidedBy = 'tech'
    } else if (totals.awayTech > totals.homeTech) {
      winnerSlot = 'away'
      decidedBy = 'tech'
    } else if (playoffComplete) {
      const po = { homeWins: 0, awayWins: 0, homeTech: 0, awayTech: 0 }
      for (const c of playoff) addBoutToTotals(c, po)
      if (po.homeWins > po.awayWins || (po.homeWins === po.awayWins && po.homeTech > po.awayTech)) {
        winnerSlot = 'home'
        decidedBy = playoff.length > 1 ? 'replay' : 'golden_score'
      } else if (po.awayWins > po.homeWins || (po.awayWins === po.homeWins && po.awayTech > po.homeTech)) {
        winnerSlot = 'away'
        decidedBy = playoff.length > 1 ? 'replay' : 'golden_score'
      }
    }
  }

  return {
    home: totals.homeWins,
    away: totals.awayWins,
    homeWins: totals.homeWins,
    awayWins: totals.awayWins,
    homeTech: totals.homeTech,
    awayTech: totals.awayTech,
    regularComplete,
    goldenScore,
    playoff,
    playoffComplete,
    decidedBy,
    winnerSlot
  }
}

export function formatTeamMatchScoreLine(score: TeamMatchScoreBreakdown, match: TeamMatch): string {
  if (match.decidedBy === 'bye' && match.winnerTeamId) {
    const name = match.winnerTeamId === match.homeTeamId ? match.homeClub : match.awayClub
    if (match.homeTeamId && match.awayTeamId) {
      return `Qualifié ${name} (sans combat)`
    }
    return `Qualifié ${name} (bye)`
  }
  const base = `Score ${score.homeWins}–${score.awayWins}`
  const tech = ` · pts tech. ${score.homeTech}–${score.awayTech}`
  if (match.winnerTeamId) {
    const name = match.winnerTeamId === match.homeTeamId ? match.homeClub : match.awayClub
    const how =
      match.decidedBy === 'tech'
        ? 'aux points techniques'
        : match.decidedBy === 'replay'
          ? 'à la reprise'
          : match.decidedBy === 'golden_score'
            ? 'au golden score'
            : 'aux victoires'
    return `${base}${tech} · vainqueur ${name} (${how})`
  }
  if (score.regularComplete && !score.winnerSlot) {
    if (score.playoff.length > 0 && !score.playoffComplete) {
      return `${base}${tech} · égalité — reprise préliminaire (${score.playoff.length} combat(s))`
    }
    return `${base}${tech} · égalité — reprise des préliminaires`
  }
  if (score.homeWins + score.awayWins === 0 && score.homeTech + score.awayTech === 0) {
    return ''
  }
  return `${base}${tech}`
}

export interface TeamStanding {
  teamId: string
  club: string
  encounterPoints: number
  matchWins: number
  matchDraws: number
  matchLosses: number
  boutWins: number
  techPoints: number
}

/** Classement poule : 3 pts victoire, 1 nul, 0 défaite, puis victoires individuelles, puis pts tech. */
export function computeTeamStandings(session: CombatSession): TeamStanding[] {
  const byId = new Map<string, TeamStanding>()
  const ensure = (teamId: string, club: string): TeamStanding => {
    let row = byId.get(teamId)
    if (!row) {
      row = {
        teamId,
        club,
        encounterPoints: 0,
        matchWins: 0,
        matchDraws: 0,
        matchLosses: 0,
        boutWins: 0,
        techPoints: 0
      }
      byId.set(teamId, row)
    }
    return row
  }

  for (const match of session.teamMatches ?? []) {
    if (!match.homeTeamId || !match.awayTeamId) continue
    const home = ensure(match.homeTeamId, match.homeClub)
    const away = ensure(match.awayTeamId, match.awayClub)
    const score = teamMatchScore(session, match.id)
    home.boutWins += score.homeWins
    home.techPoints += score.homeTech
    away.boutWins += score.awayWins
    away.techPoints += score.awayTech
    if (!match.winnerTeamId) continue
    if (match.winnerTeamId === match.homeTeamId) {
      home.encounterPoints += 3
      home.matchWins += 1
      away.matchLosses += 1
    } else if (match.winnerTeamId === match.awayTeamId) {
      away.encounterPoints += 3
      away.matchWins += 1
      home.matchLosses += 1
    }
  }

  return [...byId.values()].sort(
    (a, b) =>
      b.encounterPoints - a.encounterPoints ||
      b.boutWins - a.boutWins ||
      b.techPoints - a.techPoints ||
      a.club.localeCompare(b.club, 'fr')
  )
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

function createGoldenScoreBout(
  match: TeamMatch,
  regular: ManagedCombat[],
  now: string
): ManagedCombat | null {
  if (regular.length === 0) return null
  const eligible = regular.filter((c) => c.top && c.bottom)
  const pool = eligible.length > 0 ? eligible : regular
  const source = pool[Math.floor(Math.random() * pool.length)]!
  const { status, winnerId, bye, winMethod } = boutStatus(source.top, source.bottom)
  return {
    ...source,
    id: `${match.id}::golden-score`,
    matchId: 'golden-score',
    label: 'Golden Score',
    poolKey: `${match.id}|golden-score`,
    poolLabel: `Golden Score · ${source.weightLabel}`,
    status,
    winnerId,
    winMethod,
    bye,
    goldenScore: true,
    feedsInto: null,
    feedsLoserInto: undefined,
    tatamiId: source.tatamiId,
    orderOnTatami: (source.orderOnTatami ?? 0) + 1,
    updatedAt: now
  }
}

function assignUnassignedCombatsToTatamis(session: CombatSession): CombatSession {
  const tatamis = session.tatamis
  if (tatamis.length === 0) return session
  const counts = new Map(tatamis.map((t) => [t.id, 0]))
  const maxOrder = new Map(tatamis.map((t) => [t.id, -1]))
  for (const c of session.combats) {
    if (!c.tatamiId) continue
    counts.set(c.tatamiId, (counts.get(c.tatamiId) ?? 0) + 1)
    maxOrder.set(c.tatamiId, Math.max(maxOrder.get(c.tatamiId) ?? -1, c.orderOnTatami))
  }
  const pickLeast = (): string => {
    let best = tatamis[0]!.id
    let n = counts.get(best) ?? 0
    for (const t of tatamis) {
      const c = counts.get(t.id) ?? 0
      if (c < n) {
        best = t.id
        n = c
      }
    }
    return best
  }
  return {
    ...session,
    combats: session.combats.map((c) => {
      if (c.tatamiId || !hasAtLeastOneJudoka(c)) return c
      const siblingTatami = c.goldenScore
        ? session.combats.find((x) => x.teamMatchId === c.teamMatchId && x.tatamiId && !x.goldenScore)
            ?.tatamiId
        : null
      const tatamiId = siblingTatami ?? pickLeast()
      const order = (maxOrder.get(tatamiId) ?? -1) + 1
      counts.set(tatamiId, (counts.get(tatamiId) ?? 0) + 1)
      maxOrder.set(tatamiId, order)
      return { ...c, tatamiId, orderOnTatami: order, updatedAt: session.updatedAt }
    })
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
  const byId = judokasIndexedForTeams(ctx?.teams ?? [], ctx?.judokas ?? [])
  const weightClasses = filterTeamWeightClasses(
    ctx?.weightClasses ?? [],
    session.teamSexFilter
  )

  let changed = true
  while (changed) {
    changed = false
    for (const match of matches) {
      if (match.winnerTeamId) {
        if (!match.decidedBy) match.decidedBy = 'bye'
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
        match.decidedBy = 'bye'
        changed = true
        continue
      }
      if (match.awayTeamId && !match.homeTeamId) {
        match.winnerTeamId = match.awayTeamId
        match.decidedBy = 'bye'
        changed = true
        continue
      }

      const bouts = combats.filter((c) => c.teamMatchId === match.id)
      const regular = bouts.filter((c) => !c.goldenScore)
      if (regular.length === 0) continue
      if (regular.some((c) => c.status !== 'completed')) continue

      const score = teamMatchScore({ ...session, combats }, match.id)
      if (score.winnerSlot && match.homeTeamId && match.awayTeamId) {
        match.winnerTeamId =
          score.winnerSlot === 'home' ? match.homeTeamId : match.awayTeamId
        match.decidedBy = score.decidedBy ?? 'wins'
        changed = true
        continue
      }

      if (!bouts.some((c) => c.goldenScore)) {
        const home = match.homeTeamId ? teamById.get(match.homeTeamId) : undefined
        const away = match.awayTeamId ? teamById.get(match.awayTeamId) : undefined
        const replay =
          home && away && weightClasses.length > 0
            ? buildPlayoffBouts(match, home, away, byId, weightClasses, now)
            : []
        if (replay.length > 0) {
          combats = [...combats, ...replay]
          changed = true
        } else {
          const created = createGoldenScoreBout(match, regular, now)
          if (created) {
            combats = [...combats, created]
            changed = true
          }
        }
      } else if (
        score.playoffComplete &&
        !score.winnerSlot &&
        !bouts.some((c) => c.id.endsWith('::golden-score'))
      ) {
        const created = createGoldenScoreBout(match, regular, now)
        if (created) {
          combats = [...combats, created]
          changed = true
        }
      }
    }

    for (const match of matches) {
      if (!match.homeTeamId || !match.awayTeamId) continue
      if (combats.some((c) => c.teamMatchId === match.id)) continue
      const home = teamById.get(match.homeTeamId)
      const away = teamById.get(match.awayTeamId)
      if (!home || !away || weightClasses.length === 0) continue
      const created = buildTeamBouts(match, home, away, byId, weightClasses, now)
      if (created.length === 0) {
        if (!match.winnerTeamId) {
          const pick = Math.random() < 0.5 ? home : away
          match.winnerTeamId = pick.id
          match.decidedBy = 'bye'
          changed = true
        }
        continue
      }
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
  if (next.tatamis.length === 0) return next
  const anyAssigned = next.combats.some((c) => c.tatamiId)
  if (!anyAssigned) return distributeCombatsAcrossTatamis(next)
  return assignUnassignedCombatsToTatamis(next)
}

export function listTiedTeamMatches(
  session: CombatSession,
  opts?: { preliminariesOnly?: boolean }
): TeamMatch[] {
  return (session.teamMatches ?? []).filter((m) => {
    if (opts?.preliminariesOnly && m.round !== 0) return false
    if (m.winnerTeamId || !m.homeTeamId || !m.awayTeamId) return false
    const score = teamMatchScore(session, m.id)
    return score.regularComplete && !score.winnerSlot
  })
}

/** Reprend les préliminaires à égalité avec uniquement les catégories du sexe choisi. */
export function applyTeamTieBreakReplay(
  session: CombatSession,
  ctx: TeamResolveCtx,
  sexFilter: TeamSexFilter
): { session: CombatSession; replayed: number } {
  if (session.kind !== 'team') return { session, replayed: 0 }
  const now = new Date().toISOString()
  const classes = filterTeamWeightClasses(ctx.weightClasses, sexFilter)
  const teamById = new Map(ctx.teams.map((t) => [t.id, t]))
  const byId = judokasIndexedForTeams(ctx.teams, ctx.judokas)
  const tied = listTiedTeamMatches(session, { preliminariesOnly: true })
  let combats = session.combats.map((c) => ({ ...c }))
  let replayed = 0

  for (const match of tied) {
    const home = match.homeTeamId ? teamById.get(match.homeTeamId) : undefined
    const away = match.awayTeamId ? teamById.get(match.awayTeamId) : undefined
    if (!home || !away) continue
    const hasCompletedPlayoff = combats.some(
      (c) => c.teamMatchId === match.id && c.goldenScore && c.status === 'completed'
    )
    if (hasCompletedPlayoff) continue
    combats = combats.filter(
      (c) => !(c.teamMatchId === match.id && c.goldenScore && c.status !== 'completed')
    )
    const created = buildPlayoffBouts(match, home, away, byId, classes, now)
    if (created.length === 0) continue
    combats = [...combats, ...created]
    replayed += 1
  }

  const next = resolveTeamMatches(
    {
      ...session,
      teamSexFilter: sexFilter,
      combats,
      updatedAt: now
    },
    ctx
  )
  return { session: next, replayed }
}

export const TEAM_TIRAGE_PDF_KIND = 'judovac-team-tirage'
export const TEAM_TIRAGE_PDF_VERSION = 1
export const TEAM_TIRAGE_PDF_SUBJECT_PREFIX = 'JUDVAC-TEAM-TIRAGE-1:'

export interface TeamTiragePdfSnapshot {
  kind: typeof TEAM_TIRAGE_PDF_KIND
  version: number
  generatedAt: string
  teamCount: number
  matchCount: number
  boutCount: number
  weightClasses: TeamWeightClassRange[]
  teams: Array<{ id: string; club: string; name: string }>
  matches: TeamMatch[]
  combats: ManagedCombat[]
}

export function teamTirageSnapshot(
  result: TeamTirageResult,
  teams: Team[] = [],
  weightClasses: TeamWeightClassRange[] = []
): TeamTiragePdfSnapshot {
  return {
    kind: TEAM_TIRAGE_PDF_KIND,
    version: TEAM_TIRAGE_PDF_VERSION,
    generatedAt: result.generatedAt,
    teamCount: result.teamCount,
    matchCount: result.matchCount,
    boutCount: result.boutCount,
    weightClasses: normalizeTeamWeightClasses(weightClasses),
    teams: teams.map((t) => ({ id: t.id, club: t.club, name: t.name })),
    matches: result.session.teamMatches ?? [],
    combats: result.session.combats
  }
}

export function isTeamTiragePdfSnapshot(value: unknown): value is TeamTiragePdfSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<TeamTiragePdfSnapshot>
  return (
    v.kind === TEAM_TIRAGE_PDF_KIND &&
    Number(v.version) === TEAM_TIRAGE_PDF_VERSION &&
    Array.isArray(v.matches) &&
    Array.isArray(v.combats)
  )
}

export function fighterRefToTirage(ref: CombatFighterRef | null | undefined): TirageFighter | null {
  if (!ref) return null
  return {
    id: ref.id,
    displayId: ref.displayId,
    name: ref.name,
    sex: ref.sex,
    category: ref.category,
    weightKg: ref.weightKg,
    club: ref.club,
    age: ref.age
  }
}

function clubTreeFighter(club: string, teamId: string | null): TirageFighter | null {
  const name = club.trim()
  if (!name || /^(bye|à déterminer)$/i.test(name)) return null
  return {
    id: teamId || `club-${name.toLowerCase()}`,
    displayId: '',
    name,
    sex: 'M',
    category: 'Par équipe',
    weightKg: 0,
    club: name,
    age: 0
  }
}

function teamMatchToBracketMatch(match: TeamMatch, phase = phaseForRound(1, match.round === 0)): BracketMatch {
  const top = clubTreeFighter(match.homeClub, match.homeTeamId)
  const bottom = clubTreeFighter(match.awayClub, match.awayTeamId)
  return {
    id: match.id,
    label: match.label,
    round: match.round,
    matchIndex: match.matchIndex,
    top: { fighter: top, empty: !top },
    bottom: { fighter: bottom, empty: !bottom },
    bye: Boolean((top && !bottom) || (!top && bottom) || match.decidedBy === 'bye'),
    phase,
    feedsIntoMatch: match.feedsInto
      ? {
          matchId: match.feedsInto.teamMatchId,
          slot: match.feedsInto.slot === 'home' ? 'top' : 'bottom'
        }
      : null
  }
}

/** Tableau d’élimination des clubs (même structure que le tirage individuel). */
export function teamMatchesToBracket(matches: TeamMatch[]): BracketTree {
  if (matches.length === 0) {
    return { rounds: [], size: 0, entrantCount: 0 }
  }
  const maxRound = Math.max(...matches.map((m) => m.round))
  const rounds: BracketMatch[][] = []
  for (let r = 0; r <= maxRound; r++) {
    const row = matches
      .filter((m) => m.round === r)
      .slice()
      .sort((a, b) => a.matchIndex - b.matchIndex)
    const phase = phaseForRound(row.length, r === 0)
    rounds.push(row.map((m) => teamMatchToBracketMatch(m, phase)))
  }
  const first = rounds[0] ?? []
  return {
    rounds,
    size: Math.max(2, first.length * 2),
    entrantCount: first.reduce(
      (n, m) => n + (m.top.fighter ? 1 : 0) + (m.bottom.fighter ? 1 : 0),
      0
    )
  }
}

/** Combats d’une rencontre, empilés comme le 1er tour d’une grille individuelle. */
export function teamBoutsToBracket(bouts: ManagedCombat[]): BracketTree {
  const matches: BracketMatch[] = bouts.map((c, i) => ({
    id: c.id,
    label: c.poolLabel || c.label,
    round: 0,
    matchIndex: i,
    top: { fighter: fighterRefToTirage(c.top), empty: !c.top },
    bottom: { fighter: fighterRefToTirage(c.bottom), empty: !c.bottom },
    bye: c.bye,
    phase: undefined
  }))
  return {
    rounds: matches.length ? [matches] : [],
    size: Math.max(2, matches.length * 2),
    entrantCount: matches.reduce(
      (n, m) => n + (m.top.fighter ? 1 : 0) + (m.bottom.fighter ? 1 : 0),
      0
    )
  }
}

function clubKey(name: string): string {
  return name.trim().toLowerCase()
}

function findTeamByClub(teams: Team[], club: string): Team | undefined {
  const key = clubKey(club)
  if (!key || key === 'bye' || key === 'à déterminer') return undefined
  return teams.find(
    (t) => clubKey(t.club) === key || clubKey(teamDisplayName(t)) === key || clubKey(t.name) === key
  )
}

function findJudokaByName(name: string, pool: Judoka[]): Judoka | undefined {
  const key = name.trim().toLowerCase()
  if (!key || key === 'absence' || key === '...') return undefined
  return (
    pool.find((j) => formatJudokaFullName(j).toLowerCase() === key) ??
    pool.find((j) => {
      const n = formatJudokaFullName(j).toLowerCase()
      return n.includes(key) || key.includes(n)
    })
  )
}

function syntheticFighter(
  name: string,
  club: string,
  category: string,
  sex: Sex
): CombatFighterRef {
  return {
    id: `import-${clubKey(club)}-${clubKey(name)}`.replace(/[^a-z0-9-]+/g, '-'),
    displayId: '',
    name: name.trim(),
    club: club.trim(),
    age: 0,
    sex,
    category,
    weightKg: 0
  }
}

function fighterFromName(
  name: string,
  team: Team | undefined,
  club: string,
  category: string,
  sex: Sex,
  byId: Map<string, Judoka>
): CombatFighterRef | null {
  const cleaned = name.trim()
  if (!cleaned || cleaned.toLowerCase() === 'absence' || cleaned === '...') return null
  const pool = team ? membersOf(team, byId) : [...byId.values()]
  const found = findJudokaByName(cleaned, pool)
  return found ? toFighter(found, category) : syntheticFighter(cleaned, club, category, sex)
}

function parsePoolLabel(label: string): { sex: Sex; weightLabel: string } {
  const raw = label.trim()
  const sex: Sex = /^filles/i.test(raw) ? 'F' : 'M'
  const weightLabel = raw.replace(/^(garçons|filles)\s*[·•\-–]\s*/i, '').trim() || raw
  return { sex, weightLabel }
}

export interface ImportedTeamBoutLine {
  poolLabel: string
  topName: string
  bottomName: string
}

export interface ImportedTeamMatchLine {
  label: string
  homeClub: string
  awayClub: string
  bouts: ImportedTeamBoutLine[]
}

/** Reconstruit un tirage à partir des rencontres lues dans le PDF. */
export function generateTeamTirageFromImportedMatches(
  imported: ImportedTeamMatchLine[],
  teams: Team[],
  judokas: Judoka[],
  weightClasses: TeamWeightClassRange[]
): TeamTirageResult {
  const now = new Date().toISOString()
  const classes = normalizeTeamWeightClasses(weightClasses)
  const session = createEmptyCombatSession()
  session.kind = 'team'
  session.sourceTirageAt = now
  session.updatedAt = now
  session.teamSexFilter = inferTeamSexFilter(classes)

  const pairings = imported.filter((m) => m.homeClub.trim() && m.awayClub.trim())
  if (pairings.length === 0) {
    session.teamMatches = []
    session.combats = []
    return { generatedAt: now, teamCount: 0, matchCount: 0, boutCount: 0, session }
  }

  const used = new Set<string>()
  const orderedTeams: Team[] = []
  const addTeam = (club: string): void => {
    const t = findTeamByClub(teams, club)
    if (!t || used.has(t.id)) return
    used.add(t.id)
    orderedTeams.push(t)
  }
  for (const m of pairings) {
    addTeam(m.homeClub)
    addTeam(m.awayClub)
  }

  const byId = judokasIndexedForTeams(orderedTeams.length ? orderedTeams : teams, judokas)
  const slots: Array<Team | null> = []
  for (const m of pairings) {
    slots.push(findTeamByClub(teams, m.homeClub) ?? null)
    slots.push(findTeamByClub(teams, m.awayClub) ?? null)
  }
  const size = nextPow2(Math.max(2, slots.length))
  while (slots.length < size) slots.push(null)

  const rounds = Math.round(Math.log2(size))
  const matches: TeamMatch[] = []
  const byRound: TeamMatch[][] = []
  for (let r = 0; r < rounds; r++) {
    const count = size / 2 ** (r + 1)
    const row: TeamMatch[] = []
    for (let i = 0; i < count; i++) {
      const importedMatch = r === 0 ? pairings[i] : undefined
      row.push({
        id: `tm-r${r}-m${i}`,
        label:
          importedMatch?.label?.trim() ||
          (r === rounds - 1 ? 'Finale' : r === rounds - 2 ? `Demi ${i + 1}` : `Rencontre ${i + 1}`),
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
  const combats: ManagedCombat[] = []
  for (let i = 0; i < first.length; i++) {
    const home = slots[i * 2] ?? null
    const away = slots[i * 2 + 1] ?? null
    const line = pairings[i]
    first[i]!.homeTeamId = home?.id ?? null
    first[i]!.awayTeamId = away?.id ?? null
    first[i]!.homeClub = home ? teamDisplayName(home) : line?.homeClub?.trim() || 'Bye'
    first[i]!.awayClub = away ? teamDisplayName(away) : line?.awayClub?.trim() || 'Bye'
    if (home && !away) first[i]!.winnerTeamId = home.id
    if (away && !home) first[i]!.winnerTeamId = away.id
    if (!line || (!home && !away)) continue
    if (!line.bouts.length) {
      if (home && away) {
        combats.push(...buildTeamBouts(first[i]!, home, away, byId, classes, now))
      }
      continue
    }
    const homeLabel = first[i]!.homeClub
    const awayLabel = first[i]!.awayClub
    const teamMatchLabel = `${homeLabel} vs ${awayLabel}`
    line.bouts.forEach((bout, index) => {
      const parsed = parsePoolLabel(bout.poolLabel)
      const wc =
        classes.find(
          (c) =>
            c.sex === parsed.sex &&
            c.label.trim().toLowerCase() === parsed.weightLabel.toLowerCase()
        ) ?? null
      const category = wc?.label ?? parsed.weightLabel
      const sex = wc?.sex ?? parsed.sex
      const top = fighterFromName(bout.topName, home ?? undefined, homeLabel, category, sex, byId)
      const bottom = fighterFromName(
        bout.bottomName,
        away ?? undefined,
        awayLabel,
        category,
        sex,
        byId
      )
      if (!top && !bottom) return
      const { status, winnerId, bye, winMethod } = boutStatus(top, bottom)
      combats.push({
        id: `${first[i]!.id}::bout-${sex}-${wc?.id ?? index}`,
        matchId: `bout-${wc?.id ?? index}`,
        label: `Combat ${index + 1}`,
        round: 0,
        matchIndex: index,
        poolKey: `${first[i]!.id}|${sex}|${wc?.id ?? index}`,
        poolLabel: bout.poolLabel.trim() || `${sex === 'F' ? 'Filles' : 'Garçons'} · ${category}`,
        sex,
        category,
        weightLabel: category,
        top,
        bottom,
        bye,
        tatamiId: null,
        orderOnTatami: 0,
        status,
        winnerId,
        winMethod,
        feedsInto: null,
        updatedAt: now,
        kind: 'team',
        teamMatchId: first[i]!.id,
        teamMatchLabel,
        homeClub: home?.club ?? homeLabel,
        awayClub: away?.club ?? awayLabel
      })
    })
  }

  session.teamMatches = matches
  session.combats = combats
  const uniqueTeams = new Set(
    slots.filter((t): t is Team => Boolean(t)).map((t) => t.id)
  )
  return {
    generatedAt: now,
    teamCount: uniqueTeams.size,
    matchCount: first.filter((m) => m.homeClub && m.awayClub && m.homeClub !== 'Bye').length,
    boutCount: combats.filter(hasAtLeastOneJudoka).length,
    session
  }
}

export function teamTirageResultFromSnapshot(
  snapshot: TeamTiragePdfSnapshot,
  teams: Team[],
  judokas: Judoka[]
): TeamTirageResult {
  const now = new Date().toISOString()
  const byJudoka = new Map(judokas.map((j) => [j.id, j]))
  const rebindTeam = (id: string | null, club: string): string | null => {
    if (id && teams.some((t) => t.id === id)) return id
    return findTeamByClub(teams, club)?.id ?? id
  }
  const rebindFighter = (ref: CombatFighterRef | null | undefined): CombatFighterRef | null => {
    if (!ref) return null
    const found =
      byJudoka.get(ref.id) ??
      findJudokaByName(ref.name, judokas.filter((j) => clubKey(j.club) === clubKey(ref.club))) ??
      findJudokaByName(ref.name, judokas)
    return found ? toFighter(found, ref.category || found.category) : ref
  }

  const matches = (snapshot.matches ?? []).map((m) => ({
    ...m,
    homeTeamId: rebindTeam(m.homeTeamId, m.homeClub),
    awayTeamId: rebindTeam(m.awayTeamId, m.awayClub)
  }))
  const combats = (snapshot.combats ?? []).map((c) => ({
    ...c,
    top: rebindFighter(c.top),
    bottom: rebindFighter(c.bottom),
    topSubstitute: rebindFighter(c.topSubstitute) ?? undefined,
    bottomSubstitute: rebindFighter(c.bottomSubstitute) ?? undefined,
    tatamiId: null,
    orderOnTatami: 0,
    kind: 'team' as const
  }))

  const session = createEmptyCombatSession()
  session.kind = 'team'
  session.sourceTirageAt = snapshot.generatedAt || now
  session.updatedAt = now
  session.teamSexFilter = inferTeamSexFilter(snapshot.weightClasses ?? [])
  session.teamMatches = matches
  session.combats = combats
  return {
    generatedAt: snapshot.generatedAt || now,
    teamCount: snapshot.teamCount || new Set(matches.flatMap((m) => [m.homeTeamId, m.awayTeamId].filter(Boolean))).size,
    matchCount:
      snapshot.matchCount || matches.filter((m) => m.round === 0 && m.homeClub && m.awayClub).length,
    boutCount: snapshot.boutCount || combats.filter(hasAtLeastOneJudoka).length,
    session
  }
}
