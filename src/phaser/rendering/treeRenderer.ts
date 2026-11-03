import type Phaser from 'phaser'
import type { Tree } from '@/domain/model'
import type { TerrainSurface } from '@/domain/terrain/terrainSurface'
import {
  projectSunShadow,
  projectSunShadowOntoTerrain,
} from '@/phaser/rendering/lighting'

export type TreeLayer = 'shadow' | 'canopy' | 'highlight'

export interface TreePrimitive {
  readonly layer: TreeLayer
  readonly x: number
  readonly y: number
  readonly radiusX: number
  readonly radiusY: number
  readonly color: number
  readonly alpha: number
  readonly baseHeight: number
}

const TREE_CANOPY_HEIGHT = 6

const TREE_COLORS = {
  day: {
    shadow: 0x000000,
    canopy: 0x174b2b,
    highlight: 0x2b884a,
  },
  night: {
    shadow: 0x000000,
    canopy: 0x0b2116,
    highlight: 0x174a2c,
  },
} as const

/**
 * Builds renderer-neutral scenery primitives. Keeping this pure lets editor
 * and race scenes share the exact same tree shape, lighting, and scale.
 */
export function buildTreePresentation(
  trees: readonly Tree[],
  night: boolean,
  terrainSurface?: TerrainSurface,
): readonly TreePrimitive[] {
  const colors = night ? TREE_COLORS.night : TREE_COLORS.day
  const shadows: TreePrimitive[] = []
  const canopies: TreePrimitive[] = []
  const highlights: TreePrimitive[] = []

  for (const tree of trees) {
    const baseHeight = terrainSurface?.heightAt(tree) ?? 0
    const shadow = terrainSurface
      ? projectSunShadowOntoTerrain(
          tree,
          baseHeight + TREE_CANOPY_HEIGHT,
          terrainSurface,
        ).point
      : projectSunShadow(tree, TREE_CANOPY_HEIGHT)
    shadows.push({
      layer: 'shadow',
      x: shadow.x,
      y: shadow.y,
      radiusX: 14,
      radiusY: 7,
      color: colors.shadow,
      alpha: night ? 0.14 : 0.22,
      baseHeight,
    })
    canopies.push({
      layer: 'canopy',
      x: tree.x,
      y: tree.y,
      radiusX: 15,
      radiusY: 15,
      color: colors.canopy,
      alpha: 1,
      baseHeight,
    })
    highlights.push({
      layer: 'highlight',
      x: tree.x - 4,
      y: tree.y - 5,
      radiusX: 10,
      radiusY: 10,
      color: colors.highlight,
      alpha: 1,
      baseHeight,
    })
  }

  return [...shadows, ...canopies, ...highlights]
}

export function renderTrees(
  graphics: Phaser.GameObjects.Graphics,
  trees: readonly Tree[],
  night: boolean,
  terrainSurface?: TerrainSurface,
): void {
  for (
    const primitive of buildTreePresentation(
      trees,
      night,
      terrainSurface,
    )
  ) {
    graphics.fillStyle(primitive.color, primitive.alpha)
    graphics.fillEllipse(
      primitive.x,
      primitive.y,
      primitive.radiusX * 2,
      primitive.radiusY * 2,
    )
  }
}
