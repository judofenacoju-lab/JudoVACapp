/** Phase d’un combat individuel (élimination + repêchage). */
export type CombatPhase =
  | 'preliminaire'
  | 'huitieme'
  | 'quart'
  | 'repechage'
  | 'demi'
  | 'bronze'
  | 'finale'

/**
 * Nomme un tour selon le nombre réel de combats de ce tour.
 * Tour 1 = Préliminaires, sauf 4 combats (Quart), 2 (Demi) ou 1 (Finale).
 */
export function phaseForRound(matchCount: number, isFirstRound: boolean): CombatPhase {
  if (matchCount <= 0) return 'finale'
  if (isFirstRound) {
    if (matchCount === 4) return 'quart'
    if (matchCount === 2) return 'demi'
    if (matchCount === 1) return 'finale'
    return 'preliminaire'
  }
  if (matchCount >= 16) return 'preliminaire'
  if (matchCount === 8) return 'huitieme'
  if (matchCount === 4) return 'quart'
  if (matchCount === 2) return 'demi'
  return 'finale'
}

/**
 * Nomme un tour du tableau principal selon le 1er tour et l’indice
 * (hypothèse d’un tableau qui se divise par 2 à chaque tour).
 */
export function mainRoundPhase(firstRoundMatchCount: number, roundIndex: number): CombatPhase {
  if (firstRoundMatchCount <= 0) return 'finale'
  const n = firstRoundMatchCount / 2 ** roundIndex
  if (!Number.isFinite(n) || n < 1) return 'finale'
  return phaseForRound(Math.round(n), roundIndex === 0)
}

export function combatPhaseLabel(
  phase: CombatPhase | string | null | undefined,
  style: 'full' | 'chrono' = 'full'
): string {
  switch (phase) {
    case 'preliminaire':
      return style === 'chrono' ? 'Préliminaire' : 'Préliminaires'
    case 'huitieme':
      return style === 'chrono' ? 'Huitième' : 'Huitième de finale'
    case 'quart':
      return style === 'chrono' ? 'Quart de Finale' : 'Quart de finale'
    case 'repechage':
      return 'Repêchage'
    case 'demi':
      return style === 'chrono' ? 'Demi-Finale' : 'Demi-finale'
    case 'bronze':
      return style === 'chrono' ? 'Finale' : 'Finale de Bronze'
    case 'finale':
      return style === 'chrono' ? 'Finale' : 'Finale Or'
    default:
      return ''
  }
}
