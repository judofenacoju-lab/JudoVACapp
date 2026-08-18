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
 * Nomme un tour du tableau principal selon le nombre de combats de ce tour.
 * Tour 1 = Préliminaires, sauf départ à 4 combats (Quart de finale).
 * Ensuite : 8 = Huitième, 4 = Quart, 2 = Demi-finale, 1 = Finale Or.
 */
export function mainRoundPhase(firstRoundMatchCount: number, roundIndex: number): CombatPhase {
  if (firstRoundMatchCount <= 0) return 'finale'
  const n = firstRoundMatchCount / 2 ** roundIndex
  if (!Number.isFinite(n) || n < 1) return 'finale'
  if (roundIndex === 0) {
    if (firstRoundMatchCount === 4) return 'quart'
    if (firstRoundMatchCount === 2) return 'demi'
    if (firstRoundMatchCount === 1) return 'finale'
    return 'preliminaire'
  }
  if (n === 8) return 'huitieme'
  if (n === 4) return 'quart'
  if (n === 2) return 'demi'
  return 'finale'
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
