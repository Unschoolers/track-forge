import type Phaser from 'phaser'
import type { Tree } from '@/domain/model'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { getMeadowBitmapArt } from '@/presentation/environments/meadowBitmapArt'
import { getSceneryBitmap } from '@/presentation/environments/sceneryBitmapArt'
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

const treeSprites = new WeakMap<Phaser.GameObjects.Graphics, Phaser.GameObjects.Image[]>()

export function renderTrees(
  graphics: Phaser.GameObjects.Graphics,
  trees: readonly Tree[],
  night: boolean,
  terrainSurface?: TerrainSurface,
  environment: TrackEnvironmentId = 'grass',
): void {
  const generated = getSceneryBitmap('tree', night)
  const bitmap = generated ?? (environment === 'grass' ? getMeadowBitmapArt(night)?.tree : undefined)
  const sprites = treeSprites.get(graphics) ?? []
  for (const sprite of sprites) sprite.setVisible(false)
  let shown = 0
  for (
    const primitive of buildTreePresentation(
      trees,
      night,
      terrainSurface,
    )
  ) {
    if (bitmap && primitive.layer !== 'shadow') {
      if (primitive.layer === 'highlight') continue
      const texture = `trackforge-${generated ? 'scenery' : 'meadow'}-tree-${night ? 'night' : 'day'}`
      const scene = graphics.scene
      if (!scene.textures.exists(texture) && !scene.textures.addCanvas(texture, bitmap)) {
        throw new Error('Could not register tree artwork')
      }
      let sprite = sprites[shown]
      if (!sprite) {
        sprite = scene.add.image(primitive.x, primitive.y, texture).setDepth(graphics.depth + 0.01)
        sprites.push(sprite)
        treeSprites.set(graphics, sprites)
      }
      sprite.setTexture(texture).setPosition(primitive.x, primitive.y)
        .setDisplaySize(34, 34).setVisible(true)
      shown++
      continue
    }
    graphics.fillStyle(primitive.color, primitive.alpha)
    graphics.fillEllipse(
      primitive.x,
      primitive.y,
      primitive.radiusX * 2,
      primitive.radiusY * 2,
    )
  }
  // Keep only currently authored trees; no growing sprite pool after deletes.
  for (const sprite of sprites.splice(shown)) sprite.destroy()
}
