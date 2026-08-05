import type { Judoka, Sex } from '@shared/types/judoka'
import {
  formatJudokaFullName,
  hasRecordedWeight,
  resolveJudokaCategory
} from '@shared/utils/judoka'

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
  /** Seuils / catégories de poids définis avant le tirage. */
  weightClasses: TirageWeightClass[]
  /** Si true, évite autant que possible les combats entre judokas du même club. */
  avoidSameClub: boolean
}

export const DEFAULT_TIRAGE_SETTINGS: TirageSettings = {
  weightClasses: [],
  avoidSameClub: true
}

export interface TirageFighter {
  id: string
  displayId: string
  name: string
  sex: Sex
  category: string
  weightKg: number
  club: string
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
}

export interface BracketTree {
  /** rounds[0] = premier tour */
  rounds: BracketMatch[][]
  /** Taille du tableau (puissance de 2). */
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
  return {
    id: j.id,
    displayId: j.displayId,
    name: formatJudokaFullName(j) || j.displayId,
    sex: j.sex === 'F' ? 'F' : 'M',
    category: resolveJudokaCategory(j.birthDate, j.category) || j.category || 'Sans catégorie',
    weightKg: normalizeWeightKg(j.weightKg),
    club: j.club.trim() || 'Sans club'
  }
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

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return Math.max(2, p)
}

/** Indices de combats du 1er tour qui reçoivent un bye, espacés dans le tableau. */
function spacedByeMatchIndices(matchCount: number, byeMatchCount: number): number[] {
  if (byeMatchCount <= 0 || matchCount <= 0) return []
  const count = Math.min(byeMatchCount, matchCount)
  const chosen: number[] = []
  const used = new Set<number>()
  for (let i = 0; i < count; i++) {
    // Centres des intervalles : répartit les byes au lieu de les coller en tête de grille
    let idx = Math.floor(((2 * i + 1) * matchCount) / (2 * count))
    idx = Math.min(matchCount - 1, Math.max(0, idx))
    let guard = 0
    while (used.has(idx) && guard < matchCount) {
      idx = (idx + 1) % matchCount
      guard += 1
    }
    used.add(idx)
    chosen.push(idx)
  }
  return chosen.sort((a, b) => a - b)
}

/**
 * Place les combattants en puissance de 2 :
 * — jamais deux cases vides dans le même combat (1 judoka = bye, pas de combat fantôme) ;
 * — byes espacés dans le tableau (évite plusieurs « sans adversaire » collés) ;
 * — optionnellement évite les duels intra-club au 1er tour.
 */
function seedSlots(
  fighters: TirageFighter[],
  size: number,
  avoidSameClub: boolean,
  random: () => number
): (TirageFighter | null)[] {
  const pool = shuffleInPlace([...fighters], random)
  const slots: (TirageFighter | null)[] = Array.from({ length: size }, () => null)
  const matchCount = size / 2
  const byeMatchCount = size - pool.length
  const byeMatches = new Set(spacedByeMatchIndices(matchCount, byeMatchCount))

  let fi = 0
  for (let m = 0; m < matchCount; m++) {
    if (byeMatches.has(m)) {
      // Un seul judoka dans le combat → l’autre case reste vide (bye)
      if (random() < 0.5) {
        slots[m * 2] = pool[fi++] ?? null
        slots[m * 2 + 1] = null
      } else {
        slots[m * 2] = null
        slots[m * 2 + 1] = pool[fi++] ?? null
      }
    } else {
      slots[m * 2] = pool[fi++] ?? null
      slots[m * 2 + 1] = pool[fi++] ?? null
    }
  }

  if (!avoidSameClub) return slots

  // Échanges locaux pour éviter même club dans une paire (i, i+1)
  for (let i = 0; i < size; i += 2) {
    const a = slots[i]
    const b = slots[i + 1]
    if (!a || !b) continue
    if (a.club === 'Sans club' || a.club !== b.club) continue
    for (let j = i + 2; j < size; j++) {
      const cand = slots[j]
      if (!cand || cand.club === a.club) continue
      slots[j] = b
      slots[i + 1] = cand
      break
    }
  }
  return slots
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
    const lower = current[i + 1]!
    const dest = next[Math.floor(i / 2)]!
    dest.top = slotFromFighter(automaticWinner(upper))
    dest.bottom = slotFromFighter(automaticWinner(lower))
    dest.bye = false
  }
}

/** Libellé club + poids sous le nom (affichage grille / PDF). */
export function formatFighterMeta(fighter: TirageFighter): string {
  const w = Number.isInteger(fighter.weightKg)
    ? `${fighter.weightKg} kg`
    : `${fighter.weightKg.toFixed(1).replace('.', ',')} kg`
  return `${fighter.club} · ${w}`
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
      bracket: { rounds: [], size: 0, entrantCount: 0 },
      nextFightNumber: opts.startFightNumber ?? 1,
      fightCount: 0,
      byeCount: 0
    }
  }

  const size = nextPowerOfTwo(entrantCount)
  const slots = seedSlots(fighters, size, opts.avoidSameClub, random)
  const rounds: BracketMatch[][] = []
  let fightNumber = opts.startFightNumber ?? 1
  const prefix = opts.idPrefix ?? 'm'

  const r0: BracketMatch[] = []
  for (let i = 0; i < size; i += 2) {
    const topF = slots[i] ?? null
    const bottomF = slots[i + 1] ?? null
    const bye = !topF || !bottomF
    const num = fightNumber
    fightNumber += 1
    r0.push({
      id: `${prefix}-r0-${i / 2}`,
      label: fightLabel(0, num),
      round: 0,
      matchIndex: i / 2,
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
    bracket: { rounds, size, entrantCount },
    nextFightNumber: fightNumber,
    fightCount,
    byeCount
  }
}

/**
 * Tirage aléatoire des combats pour les judokas pesés.
 * Groupes = Sexe × Catégorie d’âge × Libellé de poids (tranche min–max).
 * Le poids exact (kg) ne sépare pas les combats : tout le libellé combat ensemble.
 */
export function generateTirage(
  judokas: Judoka[],
  settings: TirageSettings = DEFAULT_TIRAGE_SETTINGS,
  random: () => number = Math.random
): TirageResult {
  const weightClasses = normalizeWeightClasses(settings.weightClasses ?? [])
  if (weightClasses.length === 0) {
    throw new Error('Ajoutez au moins une catégorie de poids avant de lancer le tirage.')
  }

  const weighed = judokas.filter((j) => hasRecordedWeight(j.weightKg)).map(toFighter)

  type Bucket = {
    sex: Sex
    category: string
    weightClass: TirageWeightClass
    fighters: TirageFighter[]
  }
  const buckets = new Map<string, Bucket>()
  let matchedCount = 0

  for (const f of weighed) {
    const wc = matchWeightClass(f.weightKg, weightClasses)
    if (!wc) continue
    matchedCount += 1
    // Clé = libellé (pas le kg exact) + catégorie d’âge + sexe
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
    return a.weightClass.maxKg - b.weightClass.maxKg || a.weightClass.minKg - b.weightClass.minKg
  })

  const pools: TiragePool[] = []
  let fightNumber = 1
  let fightCount = 0
  let byeCount = 0

  for (const bucket of sorted) {
    if (bucket.fighters.length === 0) continue
    const wc = bucket.weightClass
    const built = buildBracket(
      bucket.fighters,
      {
        avoidSameClub: settings.avoidSameClub,
        startFightNumber: fightNumber,
        idPrefix: `${bucket.sex}-${bucket.category}-${wc.id}`
      },
      random
    )
    fightNumber = built.nextFightNumber
    fightCount += built.fightCount
    byeCount += built.byeCount

    const rangeLabel = `${wc.minKg}–${wc.maxKg} kg`
    pools.push({
      sex: bucket.sex,
      sexLabel: bucket.sex === 'F' ? 'Filles' : 'Garçons',
      category: bucket.category,
      weightClassId: wc.id,
      weightKey: wc.maxKg,
      weightLabel: `${wc.label} (${rangeLabel})`,
      entrantCount: bucket.fighters.length,
      bracket: built.bracket
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    settings: { ...settings, weightClasses },
    weighedCount: weighed.length,
    matchedCount,
    unmatchedCount: weighed.length - matchedCount,
    fightCount,
    byeCount,
    pools
  }
}
