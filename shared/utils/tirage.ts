import type { Judoka, Sex } from '@shared/types/judoka'
import {
  formatJudokaFullName,
  hasRecordedWeight,
  resolveJudokaCategory
} from '@shared/utils/judoka'

/** Options de tirage des combats. */
export interface TirageSettings {
  /** Tolérance de poids en kg (0 = poids identiques à 0,1 kg près). */
  weightToleranceKg: number
  /** Si true, évite autant que possible les combats entre judokas du même club. */
  avoidSameClub: boolean
}

export const DEFAULT_TIRAGE_SETTINGS: TirageSettings = {
  weightToleranceKg: 0,
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
  weightKey: number
  fights: TirageFight[]
  /** Judokas dans le groupe avant appariement. */
  entrantCount: number
}

export interface TirageResult {
  generatedAt: string
  settings: TirageSettings
  weighedCount: number
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

function formatWeightLabel(weightKg: number): string {
  return Number.isInteger(weightKg) ? `${weightKg} kg` : `${weightKg.toFixed(1).replace('.', ',')} kg`
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

function weightCompatible(a: TirageFighter, b: TirageFighter, toleranceKg: number): boolean {
  const diff = Math.abs(a.weightKg - b.weightKg)
  if (toleranceKg <= 0) return diff < 0.05
  return diff <= toleranceKg + 1e-9
}

function pickPartner(
  a: TirageFighter,
  candidates: TirageFighter[],
  used: Set<string>,
  opts: { toleranceKg: number; avoidSameClub: boolean }
): TirageFighter | null {
  const available = candidates.filter(
    (c) => !used.has(c.id) && c.id !== a.id && weightCompatible(a, c, opts.toleranceKg)
  )
  if (available.length === 0) return null

  if (opts.avoidSameClub && a.club !== 'Sans club') {
    const otherClub = available.filter((c) => c.club !== a.club)
    if (otherClub.length > 0) return otherClub[0]!
  }
  return available[0]!
}

/**
 * Apparie une liste (même sexe / catégorie) de façon aléatoire,
 * en respectant la tolérance de poids.
 */
export function pairFighters(
  fighters: TirageFighter[],
  opts: {
    toleranceKg: number
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

    const partner = pickPartner(a, pool, used, {
      toleranceKg: opts.toleranceKg,
      avoidSameClub: opts.avoidSameClub
    })

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

function poolWeightLabel(fights: TirageFight[], fighters: TirageFighter[]): string {
  const fromFights = fights.flatMap((f) => (f.b ? [f.a, f.b] : [f.a]))
  const list = fromFights.length > 0 ? fromFights : fighters
  const weights = list.map((f) => f.weightKg)
  const min = Math.min(...weights)
  const max = Math.max(...weights)
  if (min === max) return formatWeightLabel(min)
  return `${formatWeightLabel(min).replace(' kg', '')}–${formatWeightLabel(max)}`
}

/**
 * Tirage aléatoire des combats pour les judokas pesés.
 * Garçons entre eux, filles entre elles ; groupes Sexe × Catégorie, poids compatible.
 */
export function generateTirage(
  judokas: Judoka[],
  settings: TirageSettings = DEFAULT_TIRAGE_SETTINGS,
  random: () => number = Math.random
): TirageResult {
  const weighed = judokas.filter((j) => hasRecordedWeight(j.weightKg)).map(toFighter)
  const tolerance = Math.max(0, Number(settings.weightToleranceKg) || 0)

  type Group = { sex: Sex; category: string; fighters: TirageFighter[] }
  const groups = new Map<string, Group>()

  for (const f of weighed) {
    const key = `${f.sex}::${f.category}`
    let group = groups.get(key)
    if (!group) {
      group = { sex: f.sex, category: f.category, fighters: [] }
      groups.set(key, group)
    }
    group.fighters.push(f)
  }

  const sortedGroups = [...groups.values()].sort((a, b) => {
    if (a.sex !== b.sex) return a.sex === 'M' ? -1 : 1
    return a.category.localeCompare(b.category, 'fr')
  })

  const pools: TiragePool[] = []
  let fightNumber = 1
  let fightCount = 0
  let byeCount = 0

  for (const group of sortedGroups) {
    if (group.fighters.length === 0) continue

    if (tolerance <= 0) {
      // Sous-groupes à poids identique
      const byWeight = new Map<number, TirageFighter[]>()
      for (const f of group.fighters) {
        const list = byWeight.get(f.weightKg) ?? []
        list.push(f)
        byWeight.set(f.weightKg, list)
      }
      const weights = [...byWeight.keys()].sort((a, b) => a - b)
      for (const w of weights) {
        const fighters = byWeight.get(w)!
        const { fights, nextNumber } = pairFighters(
          fighters,
          {
            toleranceKg: 0,
            avoidSameClub: settings.avoidSameClub,
            fightIdPrefix: `${group.sex}-${group.category}-${w}`,
            startNumber: fightNumber
          },
          random
        )
        fightNumber = nextNumber
        fightCount += fights.filter((f) => !f.bye).length
        byeCount += fights.filter((f) => f.bye).length
        pools.push({
          sex: group.sex,
          sexLabel: group.sex === 'F' ? 'Filles' : 'Garçons',
          category: group.category,
          weightKey: w,
          weightLabel: formatWeightLabel(w),
          fights,
          entrantCount: fighters.length
        })
      }
      continue
    }

    const { fights, nextNumber } = pairFighters(
      group.fighters,
      {
        toleranceKg: tolerance,
        avoidSameClub: settings.avoidSameClub,
        fightIdPrefix: `${group.sex}-${group.category}`,
        startNumber: fightNumber
      },
      random
    )
    fightNumber = nextNumber
    fightCount += fights.filter((f) => !f.bye).length
    byeCount += fights.filter((f) => f.bye).length
    pools.push({
      sex: group.sex,
      sexLabel: group.sex === 'F' ? 'Filles' : 'Garçons',
      category: group.category,
      weightKey: group.fighters[0]!.weightKg,
      weightLabel: poolWeightLabel(fights, group.fighters),
      fights,
      entrantCount: group.fighters.length
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    settings: { ...settings, weightToleranceKg: tolerance },
    weighedCount: weighed.length,
    fightCount,
    byeCount,
    pools
  }
}
