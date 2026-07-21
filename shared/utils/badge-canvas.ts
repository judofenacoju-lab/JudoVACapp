import type { BadgeSizeMm } from '@shared/types/badge'

/** Échelle design : 1 mm physique ≈ 2,5 unités canvas. */
export const BADGE_DESIGN_MM_SCALE = 2.5

export function badgeDesignCanvas(size: BadgeSizeMm): { width: number; height: number } {
  return {
    width: size.widthMm * BADGE_DESIGN_MM_SCALE,
    height: size.heightMm * BADGE_DESIGN_MM_SCALE
  }
}
