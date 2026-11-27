import { TREE_SIZE, sceneryScale, sceneryRotation } from '@/domain/track/sceneryTransform'
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
  readonly rotation?: number
}

export interface TreeViewBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
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
 * Bounds are optional because callers with moving cameras must refresh the
 * presentation when the viewport moves; omitting them always renders safely.
 */
export function buildTreePresentation(
  trees: readonly Tree[],
  night: boolean,
  terrainSurface?: TerrainSurface,
  viewBounds?: TreeViewBounds,
): readonly TreePrimitive[] {
  const colors = night ? TREE_COLORS.night : TREE_COLORS.day
  const shadows: TreePrimitive[] = []
  const canopies: TreePrimitive[] = []
  const highlights: TreePrimitive[] = []

  for (const tree of trees) {
    const size = TREE_SIZE * sceneryScale(tree)
    const factor = size / 34
    const rotation = sceneryRotation(tree)
    const baseHeight = terrainSurface?.heightAt(tree) ?? 0
    const shadow = terrainSurface
      ? projectSunShadowOntoTerrain(
          tree,
          baseHeight + TREE_CANOPY_HEIGHT * factor,
          terrainSurface,
        ).point
      : projectSunShadow(tree, TREE_CANOPY_HEIGHT * factor)
    // Include the scaled canopy and projected shadow in the culling bounds.
    const canopyVisible = !viewBounds || intersectsEllipse(
      tree.x,
      tree.y,
      size / 2,
      size / 2,
      viewBounds,
    )
    const shadowVisible = !viewBounds || intersectsEllipse(
      shadow.x,
      shadow.y,
      14 * factor,
      7 * factor,
      viewBounds,
    )
    if (!canopyVisible && !shadowVisible) continue
    shadows.push({
      layer: 'shadow',
      x: shadow.x,
      y: shadow.y,
      radiusX: 14 * factor,
      radiusY: 7 * factor,
      color: colors.shadow,
      alpha: night ? 0.14 : 0.22,
      baseHeight,
    })
    canopies.push({
      layer: 'canopy',
      x: tree.x,
      y: tree.y,
      radiusX: size / 2,
      radiusY: size / 2,
      rotation,
      color: colors.canopy,
      alpha: 1,
      baseHeight,
    })
    highlights.push({
      layer: 'highlight',
      x: tree.x + (-4 * Math.cos(rotation) + 5 * Math.sin(rotation)) * factor,
      y: tree.y + (-4 * Math.sin(rotation) - 5 * Math.cos(rotation)) * factor,
      radiusX: 10 * factor,
      radiusY: 10 * factor,
      color: colors.highlight,
      alpha: 1,
      baseHeight,
    })
  }

  return [...shadows, ...canopies, ...highlights]
}

function intersectsEllipse(
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  bounds: TreeViewBounds,
): boolean {
  return x + radiusX >= bounds.left && x - radiusX <= bounds.right &&
    y + radiusY >= bounds.top && y - radiusY <= bounds.bottom
}

const MAX_GPU_TREE_BATCH = 512

/** Immutable race canopies: one native GPU batch per bounded chunk. */
export function renderStaticTreeCanopies(
  scene: Phaser.Scene,
  texture: string,
  width: number,
  height: number,
  depth: number,
  canopies: readonly TreePrimitive[],
): void {
  for (let start = 0; start < canopies.length; start += MAX_GPU_TREE_BATCH) {
    const chunk = canopies.slice(start, start + MAX_GPU_TREE_BATCH)
    const layer = scene.add.spriteGPULayer(texture, chunk.length).setDepth(depth)
    for (const tree of chunk) {
      layer.addMember({
        x: tree.x, y: tree.y, frame: '__BASE',
        originX: 0.5, originY: 0.5, scaleX: tree.radiusX * 2 / width, scaleY: tree.radiusY * 2 / height,
        rotation: tree.rotation ?? 0,
      })
    }
  }
}

const treeSprites = new WeakMap<Phaser.GameObjects.Graphics, Phaser.GameObjects.Image[]>()

export function renderTrees(
  graphics: Phaser.GameObjects.Graphics,
  trees: readonly Tree[],
  night: boolean,
  terrainSurface?: TerrainSurface,
  environment: TrackEnvironmentId = 'grass',
  viewBounds?: TreeViewBounds,
  staticGpuBatch = false,
): void {
  graphics.clear()
  const generated = getSceneryBitmap('tree', night)
  const bitmap = generated ?? (environment === 'grass' ? getMeadowBitmapArt(night)?.tree : undefined)
  if (bitmap && staticGpuBatch) {
    const scene = graphics.scene
    const texture = `trackforge-${generated ? 'scenery' : 'meadow'}-tree-${night ? 'night' : 'day'}`
    if (!scene.textures.exists(texture) && !scene.textures.addCanvas(texture, bitmap)) {
      throw new Error('Could not register tree artwork')
    }
    const primitives = buildTreePresentation(trees, night, terrainSurface, viewBounds)
    for (const shadow of primitives) {
      if (shadow.layer !== 'shadow') continue
      graphics.fillStyle(shadow.color, shadow.alpha)
      graphics.fillEllipse(shadow.x, shadow.y, shadow.radiusX * 2, shadow.radiusY * 2)
    }
    renderStaticTreeCanopies(scene, texture, bitmap.width, bitmap.height,
      graphics.depth + 0.01, primitives.filter(item => item.layer === 'canopy'))
    return
  }
  const sprites = treeSprites.get(graphics) ?? []
  for (const sprite of sprites) sprite.setVisible(false)
  let shown = 0
  for (
    const primitive of buildTreePresentation(
      trees,
      night,
      terrainSurface,
      viewBounds,
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
        .setDisplaySize(primitive.radiusX * 2, primitive.radiusY * 2).setRotation(primitive.rotation ?? 0).setVisible(true)
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
