import type Phaser from 'phaser'
import type { Vector2 } from '@/domain/model'
import type { SceneryProp, SceneryPropKind, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { groundViewportBounds, GROUND_TILE_SIZE, type GroundViewport } from '@/presentation/environments/groundTexture'
import { buildSceneryRenderPlan } from '@/presentation/environments/sceneryPresentation'
import type { SceneryPrimitive } from '@/presentation/environments/types'
import { getSceneryAtlas, type SceneryBitmapResolver } from '@/presentation/environments/sceneryBitmapArt'
import { registerSceneryFrame } from './sceneryAtlasTexture'

const resolveAtlas: SceneryBitmapResolver = (kind, night) => getSceneryAtlas(kind, night)?.source
const isBuilding = (kind: SceneryPropKind): boolean => kind === 'city-house' || kind === 'city-building'

/** Caches an overscanned world-space window until its tile boundary changes. */
export class SceneryRenderer {
  private key = ''
  private props: readonly SceneryProp[] | undefined
  private readonly sprites: Phaser.GameObjects.Image[] = []

  constructor(private readonly graphics: Phaser.GameObjects.Graphics, private readonly resolveBitmap: SceneryBitmapResolver = resolveAtlas,
    private readonly foreground?: Phaser.GameObjects.Graphics) {}

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
    }, this.resolveBitmap, this.foreground ? isBuilding : undefined)
    // Invalidate the previous cache as soon as its graphics are about to change.
    this.key = ''
    this.props = undefined
    this.drawPrimitives(this.graphics, plan.primitives)
    if (this.foreground) this.drawPrimitives(this.foreground, plan.foregroundPrimitives)
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
      const depth = (this.foreground && isBuilding(prop.kind) ? this.foreground.depth : this.graphics.depth) + 0.01
      let sprite = this.sprites[index]
      if (!sprite) {
        sprite = scene.add.image(prop.x, prop.y, texture, native?.frame).setDepth(depth)
        this.sprites.push(sprite)
      } else if (sprite.depth !== depth) sprite.setDepth(depth)
      (native ? sprite.setTexture(texture, native.frame) : sprite.setTexture(texture)).setPosition(prop.x, prop.y).setDisplaySize(prop.size, prop.size).setRotation(prop.rotation)
    }
    for (const sprite of this.sprites.splice(plan.sprites.length)) sprite.destroy()

    // Never cache an incomplete frame; the next update must retry after a
    // rendering exception instead of leaving scenery missing indefinitely.
    this.key = key
    this.props = props
  }

  private drawPrimitives(graphics: Phaser.GameObjects.Graphics, primitives: readonly SceneryPrimitive[]): void {
    graphics.clear()
    for (const primitive of primitives) {
      graphics.fillStyle(primitive.color, primitive.alpha ?? 1)
      if (primitive.kind === 'ellipse') {
        if (primitive.rotation) {
          graphics.save()
          graphics.translateCanvas(primitive.x, primitive.y)
          graphics.rotateCanvas(primitive.rotation)
          graphics.fillEllipse(0, 0, primitive.radiusX * 2, primitive.radiusY * 2)
          graphics.restore()
        } else {
          graphics.fillEllipse(primitive.x, primitive.y, primitive.radiusX * 2, primitive.radiusY * 2)
        }
      } else {
        const first = primitive.points[0]
        if (!first) continue
        graphics.beginPath()
        graphics.moveTo(first.x, first.y)
        for (const point of primitive.points.slice(1)) graphics.lineTo(point.x, point.y)
        graphics.closePath()
        graphics.fillPath()
      }
    }
  }

  destroy(): void {
    for (const sprite of this.sprites.splice(0)) sprite.destroy()
    this.key = ''
    this.props = undefined
  }
}
