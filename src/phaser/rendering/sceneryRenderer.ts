import type Phaser from 'phaser'
import type { Vector2 } from '@/domain/model'
import type { SceneryProp, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { groundViewportBounds, GROUND_TILE_SIZE, type GroundViewport } from '@/presentation/environments/groundTexture'
import { buildSceneryPresentation } from '@/presentation/environments/sceneryPresentation'

/** Caches an overscanned world-space window until its tile boundary changes. */
export class SceneryRenderer {
  private key = ''
  private props?: readonly SceneryProp[]

  constructor(private readonly graphics: Phaser.GameObjects.Graphics) {}

  render(view: GroundViewport, environmentId: TrackEnvironmentId, props: readonly SceneryProp[], night: boolean, preview?: { index: number; position: Vector2 }): void {
    const bounds = groundViewportBounds(view)
    const left = Math.floor(bounds.left / GROUND_TILE_SIZE) - 1
    const top = Math.floor(bounds.top / GROUND_TILE_SIZE) - 1
    const right = Math.ceil(bounds.right / GROUND_TILE_SIZE) + 1
    const bottom = Math.ceil(bounds.bottom / GROUND_TILE_SIZE) + 1
    const key = `${environmentId}:${night}:${left}:${top}:${right}:${bottom}:${preview?.index}:${preview?.position.x}:${preview?.position.y}`
    if (this.key === key && this.props === props) return
    this.key = key
    this.props = props
    const shown = preview && props[preview.index]
      ? props.map((prop, index) => index === preview.index ? { ...prop, ...preview.position } : prop)
      : props
    const primitives = buildSceneryPresentation(environmentId, shown, night ? 'night' : 'day', {
      left: left * GROUND_TILE_SIZE, top: top * GROUND_TILE_SIZE,
      right: right * GROUND_TILE_SIZE, bottom: bottom * GROUND_TILE_SIZE,
    })
    this.graphics.clear()
    for (const primitive of primitives) {
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
  }
}
