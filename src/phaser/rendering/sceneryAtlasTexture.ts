import type Phaser from 'phaser'
import { getSceneryAtlas, SCENERY_SPRITE_SIZE, type SceneryAtlasSource, type ScenerySpriteKind } from '@/presentation/environments/sceneryBitmapArt'

export interface SceneryFrame {
  readonly key: string
  readonly frame: ScenerySpriteKind
}

/** Register each environment/lighting sheet once using Phaser's native
 * named texture frames. All its sprites share the same GPU texture. */
export function registerSceneryAtlas(scene: Phaser.Scene, atlas: SceneryAtlasSource, night: boolean): string {
  const key = `trackforge-scenery-atlas-${atlas.id}-${night ? 'night' : 'day'}`
  if (scene.textures.exists(key)) return key
  const texture = atlas.source instanceof HTMLCanvasElement
    ? scene.textures.addCanvas(key, atlas.source)
    : scene.textures.addImage(key, atlas.source)
  if (!texture) throw new Error(`Could not register scenery atlas ${atlas.id}`)
  const size = SCENERY_SPRITE_SIZE
  try {
    atlas.kinds.forEach((kind, index) => {
      if (!texture.add(kind, 0, index % atlas.columns * size, Math.floor(index / atlas.columns) * size, size, size)) {
        throw new Error(`Could not register scenery frame ${kind}`)
      }
    })
  } catch (error) {
    scene.textures.remove(key)
    throw error
  }
  return key
}

export function registerSceneryFrame(scene: Phaser.Scene, kind: ScenerySpriteKind, night: boolean): SceneryFrame | undefined {
  const atlas = getSceneryAtlas(kind, night)
  return atlas ? { key: registerSceneryAtlas(scene, atlas, night), frame: kind } : undefined
}
