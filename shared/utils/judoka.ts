/**
 * Calcule l'âge à partir d'une date ISO (AAAA-MM-JJ).
 * Partagé UI / domain / PDF — logique pure.
 */
export function computeAge(birthDate: string, at: Date = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number)
  if (!y || !m || !d) return 0
  let age = at.getFullYear() - y
  const month = at.getMonth() + 1
  const day = at.getDate()
  if (month < m || (month === m && day < d)) age -= 1
  return Math.max(0, age)
}

/** Catégories d'âge par défaut (formulaire judoka). */
export const DEFAULT_JUDOKA_CATEGORIES = [
  'Eveil',
  'Pré-poussin',
  'Poussin',
  'Benjamin',
  'Minim',
  'Cadet',
  'Junior',
  'Sénior'
] as const

export type DefaultJudokaCategory = (typeof DEFAULT_JUDOKA_CATEGORIES)[number]

const CATEGORY_BY_AGE: ReadonlyArray<{ min: number; max: number; category: DefaultJudokaCategory }> = [
  { min: 4, max: 5, category: 'Eveil' },
  { min: 6, max: 8, category: 'Pré-poussin' },
  { min: 9, max: 10, category: 'Poussin' },
  { min: 11, max: 12, category: 'Benjamin' },
  { min: 13, max: 14, category: 'Minim' },
  { min: 15, max: 18, category: 'Cadet' },
  { min: 19, max: 21, category: 'Junior' },
  { min: 22, max: 99, category: 'Sénior' }
]

/** Catégorie par défaut selon l'âge (null hors plages). */
export function categoryFromAge(age: number): DefaultJudokaCategory | null {
  if (!Number.isFinite(age) || age < 0) return null
  const hit = CATEGORY_BY_AGE.find((r) => age >= r.min && age <= r.max)
  return hit?.category ?? null
}

/** Affichage badge : Prénom Nom uniquement. */
export function formatBadgeJudokaName(parts: { firstName: string; lastName: string }): string {
  const first = parts.firstName.trim()
  const last = parts.lastName.trim()
  if (first && last) return `${first} ${last}`
  return first || last
}

/** Catégorie badge sans le poids (évite doublon avec le champ poids). */
export function formatBadgeCategory(category: string): string {
  const cleaned = category
    .replace(/\s*[-–]\s*\d+(\.\d+)?\s*kg\s*$/i, '')
    .replace(/\s+\d+(\.\d+)?\s*kg\s*$/i, '')
    .trim()
  return cleaned || category.trim()
}

/** Affichage complet Nom / Postnom / Prénom. */
export function formatJudokaFullName(parts: {
  lastName: string
  middleName?: string
  firstName: string
}): string {
  return [parts.lastName, parts.middleName, parts.firstName]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ')
}
