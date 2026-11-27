import type Phaser from 'phaser'
import type { Vector2 } from '@/domain/model'
import type { SceneryProp, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { groundViewportBounds, GROUND_TILE_SIZE, type GroundViewport } from '@/presentation/environments/groundTexture'
import { buildSceneryRenderPlan } from '@/presentation/environments/sceneryPresentation'
import { getSceneryAtlas, type SceneryBitmapResolver } from '@/presentation/environments/sceneryBitmapArt'
import { registerSceneryFrame } from './sceneryAtlasTexture'

const resolveAtlas: SceneryBitmapResolver = (kind, night) => getSceneryAtlas(kind, night)?.source

/** Caches an overscanned world-space window until its tile boundary changes. */
export class SceneryRenderer {
  private key = ''
  private props: readonly SceneryProp[] | undefined
  private readonly sprites: Phaser.GameObjects.Image[] = []

  constructor(private readonly graphics: Phaser.GameObjects.Graphics, private readonly resolveBitmap: SceneryBitmapResolver = resolveAtlas) {}

  render(view: GroundViewport, environmentId: TrackEnvironmentId, props: readonly SceneryProp[], night: boolean, preview?: { index: number; position: Vector2; rotation?: number }): void {
    const bounds = groundViewportBounds(view)
    const left = Math.floor(bounds.left / GROUND_TILE_SIZE) - 1
    const top = Math.floor(bounds.top / GROUND_TILE_SIZE) - 1
    const right = Math.ceil(bounds.right / GROUND_TILE_SIZE) + 1
    const bottom = Math.ceil(bounds.bottom / GROUND_TILE_SIZE) + 1
    const key = `${environmentId}:${night}:${left}:${top}:${right}:${bottom}:${preview?.index}:${preview?.position.x}:${preview?.position.y}:${preview?.rotation}`
    if (this.key === key && this.props === props) return
    const shown = preview && props[preview.index]
      ? props.map((prop, index) => index === preview.index ? { ...prop, ...preview.position, ...(preview.rotation !== undefined ? { rotation: preview.rotation } : {}) } : prop)
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
        if (primitive.rotation) {
          this.graphics.save()
          this.graphics.translateCanvas(primitive.x, primitive.y)
          this.graphics.rotateCanvas(primitive.rotation)
          this.graphics.fillEllipse(0, 0, primitive.radiusX * 2, primitive.radiusY * 2)
          this.graphics.restore()
        } else {
          this.graphics.fillEllipse(primitive.x, primitive.y, primitive.radiusX * 2, primitive.radiusY * 2)
        }
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
    // Share native atlas textures by environment and lighting; reuse visible images during drag.
    for (let index = 0; index < plan.sprites.length; index++) {
      const prop = plan.sprites[index]
      if (!prop) throw new Error('Missing scenery sprite presentation')
      const scene = this.graphics.scene
      const native = this.resolveBitmap === resolveAtlas ? registerSceneryFrame(scene, prop.kind, night) : undefined
      const texture = native?.key ?? `trackforge-scenery-${prop.kind}-${night ? 'night' : 'day'}`
      if (!native && !scene.textures.exists(texture)) {
        const created = 'naturalWidth' in prop.image
          ? scene.textures.addImage(texture, prop.image)
          : scene.textures.addCanvas(texture, prop.image)
        if (!created) throw new Error(`Could not register scenery artwork for ${prop.kind}`)
      }
      let sprite = this.sprites[index]
      if (!sprite) {
        sprite = scene.add.image(prop.x, prop.y, texture, native?.frame).setDepth(this.graphics.depth + 0.01)
        this.sprites.push(sprite)
      }
      (native ? sprite.setTexture(texture, native.frame) : sprite.setTexture(texture)).setPosition(prop.x, prop.y).setDisplaySize(prop.size, prop.size).setRotation(prop.rotation)
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
