import type { EnvironmentPalette } from './types'

export interface ShorelineBand {
  readonly width: number
  readonly color: number
  readonly alpha: number
}

/** Wide damp sand, exposed bank, then a crisp water-contact highlight.
 * These are symmetric presentation bands; the centerline remains the
 * authoritative hazard boundary. No terrain cells are added. */
export const MEADOW_SHORELINE = {
  day: [
    { width: 18, color: 0x6e7945, alpha: 0.62 },
    { width: 12, color: 0xc7b077, alpha: 0.86 },
    { width: 6, color: 0x9d956a, alpha: 0.9 },
    { width: 1.6, color: 0xc9edf0, alpha: 0.88 },
  ],
  night: [
    { width: 18, color: 0x344635, alpha: 0.62 },
    { width: 12, color: 0x807b57, alpha: 0.86 },
    { width: 6, color: 0x5d6f61, alpha: 0.9 },
    { width: 1.6, color: 0x88b9c1, alpha: 0.82 },
  ],
} as const satisfies Record<'day' | 'night', readonly ShorelineBand[]>

export const MAX_SHORELINE_HALF_WIDTH = 9

export function shorelineBands(palette: EnvironmentPalette, night: boolean): readonly ShorelineBand[] {
  return palette.shorelineBands ?? [
    { width: 3.5, color: palette.shorelineLand, alpha: 0.9 },
    { width: 1.2, color: palette.waterShoreline ?? (night ? 0x7eb4c1 : 0xc1edf2), alpha: 0.75 },
  ]
}
