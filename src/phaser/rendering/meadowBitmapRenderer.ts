import type Phaser from 'phaser'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { GROUND_TILE_SIZE, type GroundViewport, type WorldBounds } from '@/presentation/environments/groundTexture'
import { createMeadowBitmapLayers, type BitmapTiles } from '@/presentation/environments/meadowBitmapTiles'
import { WORLD_RENDER_DEPTH } from './renderLayers'

export const ROAD_BITMAP_DEPTH = WORLD_RENDER_DEPTH.road + 0.2
export const ROAD_MARKINGS_DEPTH = WORLD_RENDER_DEPTH.road + 0.4
let nextRenderer = 0

/** Only currently visible bitmap tiles own GPU textures. Reused world-tile
 * canvases are bounded by the CPU cache; no full-track atlas is allocated. */
class BitmapTileRenderer {
  private readonly prefix = `meadow-layer-${++nextRenderer}`
  private readonly images = new Map<string, { image: Phaser.GameObjects.Image; texture: string }>()
  private window = ''

  constructor(private readonly scene: Phaser.Scene, private readonly tiles: BitmapTiles, private readonly depth: number) {}

  render(view: GroundViewport, bounds?: WorldBounds): void {
    const tiles = this.tiles.visible(view, bounds)
    const keys = tiles.map(tile => `${tile.x}:${tile.y}`)
    const window = keys.join('|')
    if (window === this.window) return
    const wanted = new Set(keys)
    for (const [key, item] of this.images) {
      if (wanted.has(key)) continue
      this.remove(item)
      this.images.delete(key)
    }
    for (const tile of tiles) {
      const key = `${tile.x}:${tile.y}`
      if (this.images.has(key)) continue
      const texture = `${this.prefix}:${key}`
      const registered = this.scene.textures.addCanvas(texture, this.tiles.image(tile))
      if (!registered) throw new Error('Could not register Meadow bitmap tile')
      try {
        const image = this.scene.add.image(tile.x * GROUND_TILE_SIZE, tile.y * GROUND_TILE_SIZE, texture)
          .setOrigin(0).setDepth(this.depth)
        this.images.set(key, { image, texture })
      } catch (error) {
        this.scene.textures.remove(texture)
        throw error
      }
    }
    this.window = window
  }

  private remove(item: { image: Phaser.GameObjects.Image; texture: string }): void {
    item.image.destroy()
    this.scene.textures.remove(item.texture)
  }

  destroy(): void {
    for (const item of this.images.values()) this.remove(item)
    this.images.clear()
    this.window = ''
  }
}

export interface MeadowBitmapRenderer {
  render(view: GroundViewport, bounds?: WorldBounds): void
  destroy(): void
}

export function createMeadowBitmapRenderer(scene: Phaser.Scene, geometry: TrackGeometry, night: boolean, environment: TrackEnvironmentId): MeadowBitmapRenderer | undefined {
  const layers = createMeadowBitmapLayers(geometry, night, environment)
  if (!layers) return undefined
  const road = new BitmapTileRenderer(scene, layers.road, ROAD_BITMAP_DEPTH)
  const shore = new BitmapTileRenderer(scene, layers.shoreline, WORLD_RENDER_DEPTH.terrain + 0.2)
  return {
    render(view, bounds) { road.render(view, bounds); shore.render(view, bounds) },
    destroy() { road.destroy(); shore.destroy() },
  }
}
