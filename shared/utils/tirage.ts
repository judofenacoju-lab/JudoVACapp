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

export interface TirageFight {
  id: string
  number: number
  a: TirageFighter
  b: TirageFighter | null
  /** Combat sans adversaire (nombre impair). */
  bye: boolean
}

export interface TiragePool {
  sex: Sex
  sexLabel: string
  category: string
  weightLabel: string
  weightClassId: string
  weightKey: number
  fights: TirageFight[]
  /** Judokas dans le groupe avant appariement. */
  entrantCount: number
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

function pickPartner(
  a: TirageFighter,
  candidates: TirageFighter[],
  used: Set<string>,
  avoidSameClub: boolean
): TirageFighter | null {
  const available = candidates.filter((c) => !used.has(c.id) && c.id !== a.id)
  if (available.length === 0) return null

  if (avoidSameClub && a.club !== 'Sans club') {
    const otherClub = available.filter((c) => c.club !== a.club)
    if (otherClub.length > 0) return otherClub[0]!
  }
  return available[0]!
}

/**
 * Apparie une liste (même sexe / catégorie d’âge / catégorie de poids) aléatoirement.
 */
export function pairFighters(
  fighters: TirageFighter[],
  opts: {
    avoidSameClub: boolean
    fightIdPrefix: string
    startNumber: number
  },
  random: () => number = Math.random
): { fights: TirageFight[]; nextNumber: number } {
  const pool = shuffleInPlace([...fighters], random)
  const fights: TirageFight[] = []
  const used = new Set<string>()
  let number = opts.startNumber

  for (const a of pool) {
    if (used.has(a.id)) continue
    used.add(a.id)

    const partner = pickPartner(a, pool, used, opts.avoidSameClub)

    if (!partner) {
      fights.push({
        id: `${opts.fightIdPrefix}-${number}`,
        number,
        a,
        b: null,
        bye: true
      })
      number += 1
      continue
    }

    used.add(partner.id)
    fights.push({
      id: `${opts.fightIdPrefix}-${number}`,
      number,
      a,
      b: partner,
      bye: false
    })
    number += 1
  }

  return { fights, nextNumber: number }
}

/**
 * Tirage aléatoire des combats pour les judokas pesés.
 * Garçons / filles séparés ; groupes Sexe × Catégorie d’âge × Catégorie de poids.
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
    const key = `${f.sex}::${f.category}::${wc.id}`
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
    const { fights, nextNumber } = pairFighters(
      bucket.fighters,
      {
        avoidSameClub: settings.avoidSameClub,
        fightIdPrefix: `${bucket.sex}-${bucket.category}-${wc.id}`,
        startNumber: fightNumber
      },
      random
    )
    fightNumber = nextNumber
    fightCount += fights.filter((f) => !f.bye).length
    byeCount += fights.filter((f) => f.bye).length

    const rangeLabel = `${wc.minKg}–${wc.maxKg} kg`
    pools.push({
      sex: bucket.sex,
      sexLabel: bucket.sex === 'F' ? 'Filles' : 'Garçons',
      category: bucket.category,
      weightClassId: wc.id,
      weightKey: wc.maxKg,
      weightLabel: `${wc.label} (${rangeLabel})`,
      fights,
      entrantCount: bucket.fighters.length
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
