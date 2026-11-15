import type Phaser from 'phaser'
import { GRASS_TILE_PADDING } from '@/presentation/environments/grassTileImage'
import { GROUND_TILE_SIZE, type GroundViewport, visibleGroundTilesForViewport } from '@/presentation/environments/groundTexture'
import { getEnvironmentTileImage } from '@/presentation/environments/environmentTileImage'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'

/** Reuses a bounded pool of sprites backed by shared baked tile textures. */
export class GroundTextureRenderer {
  private key: string | undefined
  private readonly images: Phaser.GameObjects.Image[] = []

  constructor(private readonly scene: Phaser.Scene) {}

  render(view: GroundViewport, night: boolean, environmentId: TrackEnvironmentId = 'grass'): void {
    const tiles = visibleGroundTilesForViewport(view)
    const first = tiles[0]
    const last = tiles.at(-1)
    const key = first && last ? `${environmentId}:${night}:${first.x},${first.y}:${last.x},${last.y}` : `${environmentId}:${night}:fallback`
    if (this.key === key) return
    this.key = key
    tiles.forEach((tile, index) => {
      const textureKey = `trackforge-${environmentId}-${tile.variant}-${night ? 'night' : 'day'}`
      if (!this.scene.textures.exists(textureKey)) {
        this.scene.textures.addCanvas(textureKey, getEnvironmentTileImage(environmentId, tile.variant, night))
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
  }
}
