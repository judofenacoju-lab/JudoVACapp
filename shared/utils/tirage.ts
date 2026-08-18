import type { Judoka, Sex } from '@shared/types/judoka'
import {
  computeAge,
  formatJudokaFullName,
  hasRecordedWeight,
  resolveJudokaCategory
} from '@shared/utils/judoka'
import { phaseForRound, type CombatPhase } from '@shared/utils/combat-phase'

/** Catégorie de poids configurable pour le tirage (ex. −20 kg → 18–20). */
export interface TirageWeightClass {
  id: string
  /** Libellé affiché (ex. « -20 kg »). */
  label: string
  /** Poids mini inclus (kg). */
  minKg: number
  /** Poids maxi inclus (kg). */
  maxKg: number
}

/** Options de tirage des combats. */
export interface TirageSettings {
  /** Seuils / catégories de poids définis avant le tirage (optionnel). */
  weightClasses: TirageWeightClass[]
  /** Si true, évite autant que possible les combats entre judokas du même club. */
  avoidSameClub: boolean
  /** Filtre sexe appliqué au tirage si aucune catégorie de poids. */
  sexFilter?: '' | 'M' | 'F'
  /** Filtre catégorie d’âge appliqué au tirage si aucune catégorie de poids. */
  categoryFilter?: string
}

export const DEFAULT_TIRAGE_SETTINGS: TirageSettings = {
  weightClasses: [],
  avoidSameClub: true,
  sexFilter: '',
  categoryFilter: ''
}

export interface TirageFighter {
  id: string
  displayId: string
  name: string
  sex: Sex
  category: string
  weightKg: number
  club: string
  /** Âge en années (0 si inconnu). */
  age: number
}

export interface BracketSlot {
  fighter: TirageFighter | null
  /** Case vide (bye / adversaire manquant). */
  empty: boolean
}

export interface BracketMatch {
  id: string
  /** « Combat 1 » (1er tour) ou « C9 » (tours suivants). */
  label: string
  round: number
  matchIndex: number
  top: BracketSlot
  bottom: BracketSlot
  /** Un seul judoka → passe automatiquement. */
  bye: boolean
  phase?: CombatPhase
  feedsIntoMatch?: { matchId: string; slot: 'top' | 'bottom' } | null
  feedsLoserInto?: { matchId: string; slot: 'top' | 'bottom' } | null
}

export interface BracketTree {
  /** rounds[0] = premier tour */
  rounds: BracketMatch[][]
  /** Repêchage (perdants des quarts). */
  repechage?: BracketMatch[]
  /** Finales de bronze. */
  bronze?: BracketMatch[]
  /** Nombre de cases du 1er tour (2 × combats). */
  size: number
  entrantCount: number
}

export interface TiragePool {
  sex: Sex
  sexLabel: string
  category: string
  weightLabel: string
  weightClassId: string
  weightKey: number
  entrantCount: number
  bracket: BracketTree
}

export interface TirageResult {
  generatedAt: string
  settings: TirageSettings
  weighedCount: number
  matchedCount: number
  unmatchedCount: number
  fightCount: number
  byeCount: number
  pools: TiragePool[]
}

function normalizeWeightKg(weightKg: unknown): number {
  if (weightKg === null || weightKg === undefined) return 0
  const raw = typeof weightKg === 'string' ? weightKg.trim().replace(',', '.') : weightKg
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

function toFighter(j: Judoka): TirageFighter {
  const first = j.firstName?.trim() ?? ''
  const last = j.lastName?.trim() ?? ''
  const displayName =
    first && last ? `${first}, ${last}` : first || last || formatJudokaFullName(j) || j.displayId
  const age =
    j.age != null && Number.isFinite(j.age)
      ? Math.max(0, Math.floor(j.age))
      : j.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(j.birthDate)
        ? computeAge(j.birthDate)
        : 0
  return {
    id: j.id,
    displayId: j.displayId,
    name: displayName,
    sex: j.sex === 'F' ? 'F' : 'M',
    category: formatTirageCategoryName(
      resolveJudokaCategory(j.birthDate, j.category) || j.category || 'Sans catégorie'
    ),
    weightKg: normalizeWeightKg(j.weightKg),
    club: j.club.trim() || 'Sans club',
    age
  }
}

/** Libellé d’âge sans seuils min/max (ex. « Benjamin (10-11) » → « Benjamin »). */
export function formatTirageCategoryName(category: string): string {
  const cleaned = category
    .replace(/\s*\(\s*\d+\s*[-–/àto]+\s*\d+\s*(ans)?\s*\)/gi, '')
    .replace(/\s*\[\s*\d+\s*[-–/à]+\s*\d+\s*(ans)?\s*\]/gi, '')
    .replace(/\s+\d+\s*[-–/]\s*\d+\s*ans\b/gi, '')
    .replace(/\s+de\s+\d+\s+à\s+\d+(\s*ans)?/gi, '')
    .replace(/\s*(âge|age)\s*:?\s*\d+\s*[-–/à]\s*\d+/gi, '')
    .replace(/\s*(min|max)\s*(âge|age)?\s*:?\s*\d+/gi, '')
    .replace(/\b\d{1,2}\s*[-–/à]\s*\d{1,2}(\s*ans)?\b/gi, '')
    .replace(/\s+\d{1,2}\s*[-–]\s*\d{1,2}\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned || category.trim()
}

/** Fisher–Yates. */
export function shuffleInPlace<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}

export function createWeightClassId(): string {
  return `wc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Libellé judo classique à partir du max (ex. 20 → « -20 kg »). */
export function suggestWeightClassLabel(maxKg: number): string {
  if (!Number.isFinite(maxKg)) return ''
  const n = Number.isInteger(maxKg) ? String(maxKg) : maxKg.toFixed(1).replace('.', ',')
  return `-${n} kg`
}

export function normalizeWeightClasses(classes: TirageWeightClass[]): TirageWeightClass[] {
  return classes
    .map((c) => {
      const minKg = normalizeWeightKg(c.minKg)
      const maxKg = normalizeWeightKg(c.maxKg)
      const label = (c.label || '').trim() || suggestWeightClassLabel(maxKg)
      return {
        id: c.id || createWeightClassId(),
        label,
        minKg: Math.min(minKg, maxKg),
        maxKg: Math.max(minKg, maxKg)
      }
    })
    .filter((c) => Number.isFinite(c.minKg) && Number.isFinite(c.maxKg) && c.maxKg > 0)
    .sort((a, b) => a.maxKg - b.maxKg || a.minKg - b.minKg)
}

/** Première catégorie dont min ≤ poids ≤ max (après tri par max croissant). */
export function matchWeightClass(
  weightKg: number,
  classes: TirageWeightClass[]
): TirageWeightClass | null {
  const w = normalizeWeightKg(weightKg)
  for (const c of classes) {
    if (w >= c.minKg - 1e-9 && w <= c.maxKg + 1e-9) return c
  }
  return null
}

function popLargestClub(
  byClub: Map<string, TirageFighter[]>,
  exceptClub?: string
): TirageFighter | null {
  let best: string | null = null
  let bestLen = 0
  for (const [club, list] of byClub) {
    if (exceptClub && club === exceptClub) continue
    if (list.length > bestLen) {
      bestLen = list.length
      best = club
    }
  }
  if (!best) return null
  const list = byClub.get(best)!
  const fighter = list.pop() ?? null
  if (list.length === 0) byClub.delete(best)
  return fighter
}

function remainingFighters(byClub: Map<string, TirageFighter[]>): number {
  let n = 0
  for (const list of byClub.values()) n += list.length
  return n
}

/**
 * Associe tous les judokas du groupe au 1er tour (1 bye seulement si effectif impair).
 * Si avoidSameClub : pioche d’abord dans deux clubs différents (les plus nombreux).
 */
function pairFirstRound(
  fighters: TirageFighter[],
  avoidSameClub: boolean,
  random: () => number
): Array<[TirageFighter, TirageFighter | null]> {
  const pool = shuffleInPlace([...fighters], random)
  if (pool.length === 0) return []

  if (!avoidSameClub) {
    const pairs: Array<[TirageFighter, TirageFighter | null]> = []
    for (let i = 0; i < pool.length; i += 2) {
      pairs.push([pool[i]!, pool[i + 1] ?? null])
    }
    return shuffleInPlace(pairs, random)
  }

  const byClub = new Map<string, TirageFighter[]>()
  for (const f of pool) {
    const list = byClub.get(f.club) ?? []
    list.push(f)
    byClub.set(f.club, list)
  }
  for (const list of byClub.values()) shuffleInPlace(list, random)

  const pairs: Array<[TirageFighter, TirageFighter | null]> = []
  while (remainingFighters(byClub) >= 2) {
    const a = popLargestClub(byClub)
    if (!a) break
    const b = popLargestClub(byClub, a.club) ?? popLargestClub(byClub)
    if (b && random() < 0.5) pairs.push([b, a])
    else pairs.push([a, b])
  }
  if (remainingFighters(byClub) === 1) {
    const last = popLargestClub(byClub)
    if (last) pairs.push([last, null])
  }
  return shuffleInPlace(pairs, random)
}

/** Vainqueur automatique d’un combat (bye) — un seul judoka présent. */
function automaticWinner(match: BracketMatch): TirageFighter | null {
  const top = match.top.fighter
  const bottom = match.bottom.fighter
  if (top && !bottom) return top
  if (bottom && !top) return bottom
  return null
}

function slotFromFighter(fighter: TirageFighter | null): BracketSlot {
  return fighter ? { fighter, empty: false } : { fighter: null, empty: true }
}

/**
 * Bye = un seul passage : du combat de départ (1er tour) vers le 2e tour uniquement.
 * Pas de cascade jusqu’au vainqueur.
 */
function propagateFirstRoundByes(rounds: BracketMatch[][]): void {
  if (rounds.length < 2) return
  const current = rounds[0]!
  const next = rounds[1]!
  for (let i = 0; i < current.length; i += 2) {
    const upper = current[i]!
    const lower = current[i + 1]
    const dest = next[Math.floor(i / 2)]
    if (!dest) continue
    dest.top = slotFromFighter(automaticWinner(upper))
    dest.bottom = slotFromFighter(lower ? automaticWinner(lower) : null)
    dest.bye = false
  }
}

/** Libellé club + âge sous le nom (affichage grille / PDF). */
export function formatFighterMeta(fighter: TirageFighter): string {
  const club = fighter.club.trim() || 'Sans club'
  const agePart = fighter.age > 0 ? `${fighter.age} ans` : null
  return agePart ? `${club} · ${agePart}` : club
}

function fightLabel(round: number, number: number): string {
  return round === 0 ? `Combat ${number}` : `C${number}`
}

/**
 * Construit une grille à élimination directe à partir des judokas d’un groupe.
 */
export function buildBracket(
  fighters: TirageFighter[],
  opts: { avoidSameClub: boolean; startFightNumber?: number; idPrefix?: string },
  random: () => number = Math.random
): { bracket: BracketTree; nextFightNumber: number; fightCount: number; byeCount: number } {
  const entrantCount = fighters.length
  if (entrantCount === 0) {
    return {
      bracket: { rounds: [], repechage: [], bronze: [], size: 0, entrantCount: 0 },
      nextFightNumber: opts.startFightNumber ?? 1,
      fightCount: 0,
      byeCount: 0
    }
  }

  const pairs = pairFirstRound(fighters, opts.avoidSameClub, random)
  const rounds: BracketMatch[][] = []
  let fightNumber = opts.startFightNumber ?? 1
  const prefix = opts.idPrefix ?? 'm'
  const size = Math.max(2, pairs.length * 2)

  const r0: BracketMatch[] = []
  for (let i = 0; i < pairs.length; i++) {
    const [topF, bottomF] = pairs[i]!
    const bye = !topF || !bottomF
    const num = fightNumber
    fightNumber += 1
    r0.push({
      id: `${prefix}-r0-${i}`,
      label: fightLabel(0, num),
      round: 0,
      matchIndex: i,
      top: { fighter: topF, empty: !topF },
      bottom: { fighter: bottomF, empty: !bottomF },
      bye
    })
  }
  rounds.push(r0)

  let prevLen = r0.length
  let roundIdx = 1
  while (prevLen > 1) {
    const round: BracketMatch[] = []
    for (let i = 0; i < prevLen; i += 2) {
      const num = fightNumber
      fightNumber += 1
      round.push({
        id: `${prefix}-r${roundIdx}-${i / 2}`,
        label: fightLabel(roundIdx, num),
        round: roundIdx,
        matchIndex: i / 2,
        top: { fighter: null, empty: true },
        bottom: { fighter: null, empty: true },
        bye: false
      })
    }
    rounds.push(round)
    prevLen = round.length
    roundIdx += 1
  }

  // Bye : passage unique 1er tour → 2e tour (pas jusqu’au vainqueur)
  propagateFirstRoundByes(rounds)

  for (const [ri, round] of rounds.entries()) {
    const phase = phaseForRound(round.length, ri === 0)
    for (const m of round) {
      m.phase = phase
    }
  }

  const extra = attachRepechageAndBronze(rounds, prefix, fightNumber)
  fightNumber = extra.nextFightNumber

  let fightCount = 0
  let byeCount = 0
  for (const [ri, round] of rounds.entries()) {
    for (const m of round) {
      const n = (m.top.fighter ? 1 : 0) + (m.bottom.fighter ? 1 : 0)
      if (n === 2) fightCount += 1
      else if (ri === 0 && n === 1) byeCount += 1
    }
  }

  return {
    bracket: {
      rounds,
      repechage: extra.repechage,
      bronze: extra.bronze,
      size,
      entrantCount
    },
    nextFightNumber: fightNumber,
    fightCount,
    byeCount
  }
}

function emptyMatch(
  id: string,
  round: number,
  matchIndex: number,
  label: string,
  phase: CombatPhase
): BracketMatch {
  return {
    id,
    label,
    round,
    matchIndex,
    top: { fighter: null, empty: true },
    bottom: { fighter: null, empty: true },
    bye: false,
    phase
  }
}

/** Perdants des quarts → repêchage ; vainqueurs de repêchage vs perdants de demi → bronze. */
function attachRepechageAndBronze(
  rounds: BracketMatch[][],
  prefix: string,
  fightNumber: number
): { repechage: BracketMatch[]; bronze: BracketMatch[]; nextFightNumber: number } {
  const quartIdx = rounds.findIndex((r) => r.length === 4)
  if (quartIdx < 0) {
    return { repechage: [], bronze: [], nextFightNumber: fightNumber }
  }
  const quart = rounds[quartIdx]!
  const demi = rounds[quartIdx + 1]
  if (!demi || demi.length !== 2) {
    return { repechage: [], bronze: [], nextFightNumber: fightNumber }
  }

  const repechage: BracketMatch[] = []
  const bronze: BracketMatch[] = []
  for (let i = 0; i < 2; i++) {
    const qA = quart[i * 2]!
    const qB = quart[i * 2 + 1]!
    const sf = demi[i]!
    const repId = `${prefix}-rep-${i}`
    const brId = `${prefix}-br-${i}`
    fightNumber += 1
    const rep = emptyMatch(repId, 20, i, `Rep. ${i + 1}`, 'repechage')
    rep.feedsIntoMatch = { matchId: brId, slot: 'top' }
    qA.feedsLoserInto = { matchId: repId, slot: 'top' }
    qB.feedsLoserInto = { matchId: repId, slot: 'bottom' }
    repechage.push(rep)

    fightNumber += 1
    const br = emptyMatch(brId, 21, i, `Br. ${i + 1}`, 'bronze')
    sf.feedsLoserInto = { matchId: brId, slot: 'bottom' }
    bronze.push(br)
  }
  return { repechage, bronze, nextFightNumber: fightNumber }
}

/**
 * Tirage aléatoire des combats pour les judokas pesés.
 * Avec catégories de poids : groupes = Sexe × Catégorie d’âge × Libellé de poids.
 * Sans catégorie de poids : groupes = Sexe × Catégorie d’âge (filtres Afficher / âge appliqués).
 */
export function generateTirage(
  judokas: Judoka[],
  settings: TirageSettings = DEFAULT_TIRAGE_SETTINGS,
  random: () => number = Math.random
): TirageResult {
  const weightClasses = normalizeWeightClasses(settings.weightClasses ?? [])
  const openWeight = weightClasses.length === 0

  const weighedAll = judokas.filter((j) => hasRecordedWeight(j.weightKg)).map(toFighter)
  let weighed = weighedAll

  // Sans catégories de poids : appliquer Afficher + Filtrer catégorie d’âge au tirage
  if (openWeight) {
    const sexFilter = settings.sexFilter ?? ''
    const categoryFilter = (settings.categoryFilter ?? '').trim()
    if (sexFilter === 'M' || sexFilter === 'F') {
      weighed = weighed.filter((f) => f.sex === sexFilter)
    }
    if (categoryFilter) {
      const catKey = formatTirageCategoryName(categoryFilter)
      weighed = weighed.filter((f) => formatTirageCategoryName(f.category) === catKey)
    }
  }

  type Bucket = {
    sex: Sex
    category: string
    weightClass: TirageWeightClass | null
    fighters: TirageFighter[]
  }
  const buckets = new Map<string, Bucket>()
  let matchedCount = 0

  for (const f of weighed) {
    if (openWeight) {
      matchedCount += 1
      const key = `${f.sex}::${f.category}::open`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { sex: f.sex, category: f.category, weightClass: null, fighters: [] }
        buckets.set(key, bucket)
      }
      bucket.fighters.push(f)
      continue
    }

    const wc = matchWeightClass(f.weightKg, weightClasses)
    if (!wc) continue
    matchedCount += 1
    const labelKey = wc.label.trim().toLowerCase()
    const key = `${f.sex}::${f.category}::${labelKey}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { sex: f.sex, category: f.category, weightClass: wc, fighters: [] }
      buckets.set(key, bucket)
    }
    bucket.fighters.push(f)
  }

  const sorted = [...buckets.values()].sort((a, b) => {
    if (a.sex !== b.sex) return a.sex === 'M' ? -1 : 1
    const cat = a.category.localeCompare(b.category, 'fr')
    if (cat !== 0) return cat
    const aMax = a.weightClass?.maxKg ?? 0
    const bMax = b.weightClass?.maxKg ?? 0
    const aMin = a.weightClass?.minKg ?? 0
    const bMin = b.weightClass?.minKg ?? 0
    return aMax - bMax || aMin - bMin
  })

  const pools: TiragePool[] = []
  let fightCount = 0
  let byeCount = 0

  for (const bucket of sorted) {
    if (bucket.fighters.length === 0) continue
    const wc = bucket.weightClass
    const built = buildBracket(
      bucket.fighters,
      {
        avoidSameClub: settings.avoidSameClub,
        startFightNumber: 1,
        idPrefix: `${bucket.sex}-${bucket.category}-${wc?.id ?? 'open'}`
      },
      random
    )
    fightCount += built.fightCount
    byeCount += built.byeCount

    pools.push({
      sex: bucket.sex,
      sexLabel: bucket.sex === 'F' ? 'Filles' : 'Garçons',
      category: formatTirageCategoryName(bucket.category),
      weightClassId: wc?.id ?? 'open',
      weightKey: wc?.maxKg ?? 0,
      weightLabel: wc
        ? (wc.label || '').trim() || suggestWeightClassLabel(wc.maxKg)
        : 'Sans catégorie de poids',
      entrantCount: bucket.fighters.length,
      bracket: built.bracket
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    settings: { ...settings, weightClasses },
    weighedCount: weighedAll.length,
    matchedCount,
    unmatchedCount: Math.max(0, weighedAll.length - matchedCount),
    fightCount,
    byeCount,
    pools
  }
}
