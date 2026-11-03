import type { TerrainBrushKind } from '@/domain/model'

export const TERRAIN_BRUSH_MODES = [
  'raise',
  'lower',
  'water',
  'ground',
] as const

export type TerrainBrushMode = (typeof TERRAIN_BRUSH_MODES)[number]

/** Maps editor verbs to the one-level sparse terrain mutation they author. */
export function terrainBrushKindForMode(
  mode: TerrainBrushMode,
): TerrainBrushKind {
  switch (mode) {
    case 'raise':
      return 'hill'
    case 'water':
      return 'water'
    case 'lower':
    case 'ground':
      return 'ground'
  }
}
