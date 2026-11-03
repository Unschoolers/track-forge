import type { TerrainMap, Tree } from '@/domain/model'
import { terrainKindAt } from '@/domain/terrain/terrainField'

export type EditorRejectionCode =
  | 'invalid-tree-position'
  | 'tree-in-water'
  | 'terrain-coordinate-bounds'
  | 'terrain-capacity'
  | 'expand-terrain-bounds'
  | 'expand-terrain-capacity'

export interface EditorCommandRejection {
  readonly code: EditorRejectionCode
  readonly message: string
}

export function treePlacementRejection(
  terrain: TerrainMap,
  tree: Tree,
): EditorCommandRejection | null {
  if (!Number.isFinite(tree.x) || !Number.isFinite(tree.y)) {
    return {
      code: 'invalid-tree-position',
      message: 'Trees require a valid map position.',
    }
  }
  return terrainKindAt(terrain, tree) === 'water'
    ? {
        code: 'tree-in-water',
        message: 'Trees cannot be placed in water.',
      }
    : null
}

export const TERRAIN_CAPACITY_REJECTION: EditorCommandRejection = {
  code: 'terrain-capacity',
  message:
    'Terrain stroke cancelled: the map cannot exceed 20,000 authored cells.',
}

export const TERRAIN_COORDINATE_BOUNDS_REJECTION: EditorCommandRejection = {
  code: 'terrain-coordinate-bounds',
  message: 'Terrain stroke cancelled: the brush crossed the map boundary.',
}

export const EXPAND_TERRAIN_BOUNDS_REJECTION: EditorCommandRejection = {
  code: 'expand-terrain-bounds',
  message:
    'Expand cancelled: transformed terrain would exceed the map boundary.',
}

export const EXPAND_TERRAIN_CAPACITY_REJECTION: EditorCommandRejection = {
  code: 'expand-terrain-capacity',
  message:
    'Expand cancelled: transformed terrain would exceed 20,000 authored cells.',
}
