import type Phaser from 'phaser'
import type { Vector2 } from '@/domain/model'
import type { SceneryProp, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { groundViewportBounds, GROUND_TILE_SIZE, type GroundViewport } from '@/presentation/environments/groundTexture'
import { buildSceneryRenderPlan } from '@/presentation/environments/sceneryPresentation'
import { getSceneryBitmap, type SceneryBitmapResolver } from '@/presentation/environments/sceneryBitmapArt'

/** Caches an overscanned world-space window until its tile boundary changes. */
export class SceneryRenderer {
  private key = ''
  private props: readonly SceneryProp[] | undefined
  private readonly sprites: Phaser.GameObjects.Image[] = []

  constructor(private readonly graphics: Phaser.GameObjects.Graphics, private readonly resolveBitmap: SceneryBitmapResolver = getSceneryBitmap) {}

  render(view: GroundViewport, environmentId: TrackEnvironmentId, props: readonly SceneryProp[], night: boolean, preview?: { index: number; position: Vector2 }): void {
    const bounds = groundViewportBounds(view)
    const left = Math.floor(bounds.left / GROUND_TILE_SIZE) - 1
    const top = Math.floor(bounds.top / GROUND_TILE_SIZE) - 1
    const right = Math.ceil(bounds.right / GROUND_TILE_SIZE) + 1
    const bottom = Math.ceil(bounds.bottom / GROUND_TILE_SIZE) + 1
    const key = `${environmentId}:${night}:${left}:${top}:${right}:${bottom}:${preview?.index}:${preview?.position.x}:${preview?.position.y}`
    if (this.key === key && this.props === props) return
    const shown = preview && props[preview.index]
      ? props.map((prop, index) => index === preview.index ? { ...prop, ...preview.position } : prop)
      : props
    const plan = buildSceneryRenderPlan(environmentId, shown, night ? 'night' : 'day', {
      left: left * GROUND_TILE_SIZE, top: top * GROUND_TILE_SIZE,
      right: right * GROUND_TILE_SIZE, bottom: bottom * GROUND_TILE_SIZE,
    }, this.resolveBitmap)
    // Invalidate the previous cache as soon as its graphics are about to change.
    this.key = ''
    this.props = undefined
    this.graphics.clear()
    for (const primitive of plan.primitives) {
      this.graphics.fillStyle(primitive.color, primitive.alpha ?? 1)
      if (primitive.kind === 'ellipse') {
        this.graphics.fillEllipse(primitive.x, primitive.y, primitive.radiusX * 2, primitive.radiusY * 2)
      } else {
        const first = primitive.points[0]
        if (!first) continue
        this.graphics.beginPath()
        this.graphics.moveTo(first.x, first.y)
        for (const point of primitive.points.slice(1)) this.graphics.lineTo(point.x, point.y)
        this.graphics.closePath()
        this.graphics.fillPath()
      }
    }
    // Texture count is bounded by prop kinds × two lighting modes, shared
    // by scenes. Reuse visible objects instead of allocating on each drag.
    for (let index = 0; index < plan.sprites.length; index++) {
      const prop = plan.sprites[index]
      if (!prop) throw new Error('Missing scenery sprite presentation')
      const scene = this.graphics.scene
      const texture = `trackforge-scenery-${prop.kind}-${night ? 'night' : 'day'}`
      if (!scene.textures.exists(texture) && !scene.textures.addCanvas(texture, prop.image)) {
        throw new Error(`Could not register scenery artwork for ${prop.kind}`)
      }
      let sprite = this.sprites[index]
      if (!sprite) {
        sprite = scene.add.image(prop.x, prop.y, texture).setDepth(this.graphics.depth + 0.01)
        this.sprites.push(sprite)
      }
      sprite.setTexture(texture).setPosition(prop.x, prop.y).setDisplaySize(prop.size, prop.size)
    }
    for (const sprite of this.sprites.splice(plan.sprites.length)) sprite.destroy()

    // Never cache an incomplete frame; the next update must retry after a
    // rendering exception instead of leaving scenery missing indefinitely.
    this.key = key
    this.props = props
  }

  destroy(): void {
    for (const sprite of this.sprites.splice(0)) sprite.destroy()
    this.key = ''
    this.props = undefined
  }
}
