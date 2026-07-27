import type { CategoryAgeRange } from '@shared/types/settings'
import { createDefaultCategoryAgeRanges } from '@shared/types/settings'

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
export const DEFAULT_JUDOKA_CATEGORIES = createDefaultCategoryAgeRanges().map((r) => r.name)

export type DefaultJudokaCategory = (typeof DEFAULT_JUDOKA_CATEGORIES)[number]

const DEFAULT_RANGES: CategoryAgeRange[] = createDefaultCategoryAgeRanges()

/** Tranches actives (issues de Configuration → Catégorie). */
let activeCategoryRanges: CategoryAgeRange[] = DEFAULT_RANGES.map((r) => ({ ...r }))

export function setActiveCategoryAgeRanges(ranges: CategoryAgeRange[] | null | undefined): void {
  if (!ranges?.length) {
    activeCategoryRanges = DEFAULT_RANGES.map((r) => ({ ...r }))
    return
  }
  activeCategoryRanges = ranges
    .filter((r) => r.name.trim() && Number.isFinite(r.minAge) && Number.isFinite(r.maxAge))
    .map((r) => ({
      name: r.name.trim(),
      minAge: Math.max(0, Math.min(120, Math.floor(r.minAge))),
      maxAge: Math.max(0, Math.min(120, Math.floor(r.maxAge)))
    }))
  if (activeCategoryRanges.length === 0) {
    activeCategoryRanges = DEFAULT_RANGES.map((r) => ({ ...r }))
  }
}

export function getActiveCategoryAgeRanges(): CategoryAgeRange[] {
  return activeCategoryRanges.map((r) => ({ ...r }))
}

export function getActiveCategoryNames(): string[] {
  return activeCategoryRanges.map((r) => r.name)
}

/** Catégorie selon l'âge et les tranches configurées (ou défaut). */
export function categoryFromAge(
  age: number,
  ranges: CategoryAgeRange[] = activeCategoryRanges
): string | null {
  if (!Number.isFinite(age) || age < 0) return null
  const hit = ranges.find((r) => age >= r.minAge && age <= r.maxAge)
  return hit?.name ?? null
}

/**
 * Catégorie affichée / enregistrée : dérivée de l'âge (date de naissance),
 * sinon valeur stockée.
 */
export function resolveJudokaCategory(
  birthDate: string | undefined | null,
  storedCategory?: string | null,
  ranges?: CategoryAgeRange[]
): string {
  if (birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    const fromAge = categoryFromAge(computeAge(birthDate), ranges ?? activeCategoryRanges)
    if (fromAge) return fromAge
  }
  return (storedCategory ?? '').trim()
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

/** Normalise un champ texte pour comparaison doublon. */
export function normalizeIdentityField(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Judoka considéré comme pesé : Poids (kg) renseigné (nombre > 0, y compris chaînes / décimales).
 */
export function hasRecordedWeight(weightKg: unknown): boolean {
  if (weightKg === null || weightKg === undefined) return false
  if (typeof weightKg === 'string') {
    const t = weightKg.trim()
    if (!t) return false
    const n = Number(t.replace(',', '.'))
    return Number.isFinite(n) && n > 0
  }
  const n = Number(weightKg)
  return Number.isFinite(n) && n > 0
}

/**
 * Doublon strict : Nom + Postnom + Prénom + Date de naissance + Club identiques.
 */
export function isSameJudokaIdentity(
  a: {
    lastName: string
    middleName?: string | null
    firstName: string
    birthDate: string
    club?: string | null
  },
  b: {
    lastName: string
    middleName?: string | null
    firstName: string
    birthDate: string
    club?: string | null
  }
): boolean {
  return (
    normalizeIdentityField(a.lastName) === normalizeIdentityField(b.lastName) &&
    normalizeIdentityField(a.middleName) === normalizeIdentityField(b.middleName) &&
    normalizeIdentityField(a.firstName) === normalizeIdentityField(b.firstName) &&
    (a.birthDate ?? '').trim() === (b.birthDate ?? '').trim() &&
    normalizeIdentityField(a.club) === normalizeIdentityField(b.club)
  )
}
