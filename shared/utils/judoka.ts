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

/** Affichage badge : Prénom, Nom uniquement. */
export function formatBadgeJudokaName(parts: { firstName: string; lastName: string }): string {
  const first = parts.firstName.trim()
  const last = parts.lastName.trim()
  if (first && last) return `${first}, ${last}`
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
