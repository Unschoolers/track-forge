import { TREE_SIZE, sceneryScale, sceneryRotation, scenerySquareHalfExtent } from '@/domain/track/sceneryTransform'
import type Phaser from 'phaser'
import type { Tree } from '@/domain/model'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { getMeadowBitmapArt } from '@/presentation/environments/meadowBitmapArt'
import { getSceneryAtlas, SCENERY_SPRITE_SIZE, treeSpriteKind } from '@/presentation/environments/sceneryBitmapArt'
import { registerSceneryAtlas } from './sceneryAtlasTexture'
import type { TreeSeason } from '@/domain/track/treeSeason'
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
  readonly season?: TreeSeason
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
    const extent = scenerySquareHalfExtent(TREE_SIZE / 2, tree)
    const canopyVisible = !viewBounds || intersectsEllipse(
      tree.x,
      tree.y,
      extent,
      extent,
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
      ...(tree.season ? { season: tree.season } : {}),
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
  frameFor: (tree: TreePrimitive) => string = () => '__BASE',
): void {
  for (let start = 0; start < canopies.length; start += MAX_GPU_TREE_BATCH) {
    const chunk = canopies.slice(start, start + MAX_GPU_TREE_BATCH)
    const layer = scene.add.spriteGPULayer(texture, chunk.length).setDepth(depth)
    for (const tree of chunk) {
      layer.addMember({
        x: tree.x, y: tree.y, frame: frameFor(tree),
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
  const atlas = trees.length ? getSceneryAtlas('tree', night) : undefined
  const bitmap = !atlas && environment === 'grass' ? getMeadowBitmapArt(night)?.tree : undefined
  const primitives = buildTreePresentation(trees, night, terrainSurface, viewBounds)
  const hasCanopies = primitives.some(item => item.layer === 'canopy')
  let texture: string | undefined
  if (hasCanopies && atlas) {
    texture = registerSceneryAtlas(graphics.scene, atlas, night)
  } else if (hasCanopies && bitmap) {
    texture = `trackforge-meadow-tree-${night ? 'night' : 'day'}`
    if (!graphics.scene.textures.exists(texture) && !graphics.scene.textures.addCanvas(texture, bitmap)) {
      throw new Error('Could not register tree artwork')
    }
  }
  const frameFor = (item: TreePrimitive) => atlas ? treeSpriteKind(item.season) : '__BASE'
  if (texture && staticGpuBatch) {
    const scene = graphics.scene
    for (const shadow of primitives) {
      if (shadow.layer !== 'shadow') continue
      graphics.fillStyle(shadow.color, shadow.alpha)
      graphics.fillEllipse(shadow.x, shadow.y, shadow.radiusX * 2, shadow.radiusY * 2)
    }
    renderStaticTreeCanopies(scene, texture, atlas ? SCENERY_SPRITE_SIZE : bitmap?.width ?? SCENERY_SPRITE_SIZE,
      atlas ? SCENERY_SPRITE_SIZE : bitmap?.height ?? SCENERY_SPRITE_SIZE,
      graphics.depth + 0.01, primitives.filter(item => item.layer === 'canopy'), frameFor)
    return
  }
  const sprites = treeSprites.get(graphics) ?? []
  for (const sprite of sprites) sprite.setVisible(false)
  let shown = 0
  for (const primitive of primitives) {
    if (texture && primitive.layer !== 'shadow') {
      if (primitive.layer === 'highlight') continue
      const scene = graphics.scene
      const frame = frameFor(primitive)
      let sprite = sprites[shown]
      if (!sprite) {
        sprite = scene.add.image(primitive.x, primitive.y, texture, frame).setDepth(graphics.depth + 0.01)
        sprites.push(sprite)
        treeSprites.set(graphics, sprites)
      }
      sprite.setTexture(texture, frame).setPosition(primitive.x, primitive.y)
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
