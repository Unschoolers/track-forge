import type Phaser from 'phaser'
import { GRASS_TILE_PADDING } from '@/presentation/environments/grassTileImage'
import { GROUND_TILE_SIZE, type GroundViewport, visibleGroundTilesForViewport } from '@/presentation/environments/groundTexture'
import { getEnvironmentTileImage } from '@/presentation/environments/environmentTileImage'
import { getEnvironmentBitmapArt } from '@/presentation/environments/meadowBitmapArt'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'

export type GroundTextureManager = Pick<Phaser.Textures.TextureManager, 'exists' | 'addCanvas'>

function baseTextureKey(environmentId: TrackEnvironmentId, night: boolean): string {
  return `trackforge-${environmentId}-hd-base-${night ? 'night' : 'day'}`
}

export function ensureGroundTexture(
  textures: GroundTextureManager,
  environmentId: TrackEnvironmentId,
  variant: number,
  night: boolean,
): string {
  const base = getEnvironmentBitmapArt(environmentId, night)?.highResolutionGround
  if (base) {
    const baseKey = baseTextureKey(environmentId, night)
    if (!textures.exists(baseKey)) textures.addCanvas(baseKey, base)
  }
  const key = `trackforge-${environmentId}-${variant}-${night ? 'night' : 'day'}${base ? '-overlay' : ''}`
  if (!textures.exists(key)) {
    textures.addCanvas(key, getEnvironmentTileImage(environmentId, variant, night, Boolean(base)))
  }
  return key
}

/** Reuses a bounded pool of sprites backed by shared baked tile textures. */
export class GroundTextureRenderer {
  private key: string | undefined
  private readonly images: Phaser.GameObjects.Image[] = []
  private readonly baseImages: Phaser.GameObjects.Image[] = []

  constructor(private readonly scene: Phaser.Scene) {}

  render(view: GroundViewport, night: boolean, environmentId: TrackEnvironmentId = 'grass'): void {
    const tiles = visibleGroundTilesForViewport(view)
    const base = getEnvironmentBitmapArt(environmentId, night)?.highResolutionGround
    const first = tiles[0]
    const last = tiles.at(-1)
    const key = first && last ? `${environmentId}:${night}:${Boolean(base)}:${first.x},${first.y}:${last.x},${last.y}` : `${environmentId}:${night}:fallback`
    if (this.key === key) return
    tiles.forEach((tile, index) => {
      const textureKey = ensureGroundTexture(this.scene.textures, environmentId, tile.variant, night)
      if (base) {
        const baseKey = baseTextureKey(environmentId, night)
        let ground = this.baseImages[index]
        if (!ground) {
          ground = this.scene.add.image(0, 0, baseKey).setOrigin(0).setDepth(WORLD_RENDER_DEPTH.ground - 1)
          this.baseImages.push(ground)
        }
        ground.setTexture(baseKey)
        ground.setDisplaySize(GROUND_TILE_SIZE, GROUND_TILE_SIZE)
        ground.setPosition(tile.x * GROUND_TILE_SIZE, tile.y * GROUND_TILE_SIZE)
        ground.setVisible(true)
      }
      let image = this.images[index]
      if (!image) {
        image = this.scene.add.image(0, 0, textureKey).setOrigin(0).setDepth(WORLD_RENDER_DEPTH.ground)
        this.images.push(image)
      }
      image.setTexture(textureKey)
      image.setPosition(tile.x * GROUND_TILE_SIZE - GRASS_TILE_PADDING, tile.y * GROUND_TILE_SIZE - GRASS_TILE_PADDING)
      image.setVisible(true)
    })
    for (let i = tiles.length; i < this.images.length; i++) this.images[i]?.setVisible(false)
    for (let i = base ? tiles.length : 0; i < this.baseImages.length; i++) this.baseImages[i]?.setVisible(false)
    // Commit only after all textures and images were updated. If a GPU or
    // texture failure interrupts rendering, retry the same window next frame.
    this.key = key
  }
}
