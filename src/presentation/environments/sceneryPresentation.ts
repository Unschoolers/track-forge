import { sceneryScale, sceneryRotation, scenerySquareHalfExtent } from '@/domain/track/sceneryTransform'
import type { LightingMode } from '@/domain/model'
import type { SceneryProp, SceneryPropKind, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { getTrackEnvironment } from './index'
import type { WorldBounds } from './groundTexture'
import type { SceneryArtDefinition, SceneryPrimitive } from './types'
import { getSceneryBitmap, type SceneryBitmapResolver } from './sceneryBitmapArt'

function* visibleScenery(environmentId: TrackEnvironmentId, props: readonly SceneryProp[], bounds: WorldBounds): Generator<{ prop: SceneryProp; art: SceneryArtDefinition }> {
  const scenery = getTrackEnvironment(environmentId).scenery
  for (const prop of props) {
    const art = scenery[prop.kind]
    if (!art) continue
    const radius = scenerySquareHalfExtent(art.radius, prop)
    if (prop.x + radius < bounds.left || prop.x - radius > bounds.right || prop.y + radius < bounds.top || prop.y - radius > bounds.bottom) continue
    yield { prop, art }
  }
}

function translate(shape: SceneryPrimitive, prop: SceneryProp): SceneryPrimitive {
  const scale = sceneryScale(prop)
  const rotation = sceneryRotation(prop)
  const c = Math.cos(rotation), s = Math.sin(rotation)
  const transform = (point: { readonly x: number; readonly y: number }) => ({
    x: prop.x + scale * (point.x * c - point.y * s),
    y: prop.y + scale * (point.x * s + point.y * c),
  })
  return shape.kind === 'ellipse'
    ? { ...shape, ...transform(shape), radiusX: shape.radiusX * scale, radiusY: shape.radiusY * scale, rotation: (shape.rotation ?? 0) + rotation }
    : { ...shape, points: shape.points.map(transform) }
}

export function buildSceneryPresentation(environmentId: TrackEnvironmentId, props: readonly SceneryProp[], lighting: LightingMode, bounds: WorldBounds): readonly SceneryPrimitive[] {
  const result: SceneryPrimitive[] = []
  for (const { prop, art } of visibleScenery(environmentId, props, bounds)) {
    for (const shape of art[lighting]) result.push(translate(shape, prop))
  }
  return result
}

export interface SceneryBitmapSprite {
  readonly kind: SceneryPropKind
  readonly image: HTMLCanvasElement | HTMLImageElement
  readonly x: number
  readonly y: number
  readonly size: number
  readonly rotation: number
}

/** One presentation plan for editor, race and Canvas flyover. Keep the
 * authored radius and existing contact shadow, but replace the body art.
 * Vector art remains a deterministic pre-boot/test fallback. */
export function buildSceneryRenderPlan(
  environmentId: TrackEnvironmentId, props: readonly SceneryProp[],
  lighting: LightingMode, bounds: WorldBounds,
  resolveBitmap: SceneryBitmapResolver = getSceneryBitmap,
  isForeground?: (kind: SceneryPropKind) => boolean,
): { readonly primitives: readonly SceneryPrimitive[]; readonly foregroundPrimitives: readonly SceneryPrimitive[]; readonly sprites: readonly SceneryBitmapSprite[] } {
  const primitives: SceneryPrimitive[] = []
  const foregroundPrimitives: SceneryPrimitive[] = []
  const sprites: SceneryBitmapSprite[] = []
  for (const { prop, art } of visibleScenery(environmentId, props, bounds)) {
    const image = resolveBitmap(prop.kind, lighting === 'night')
    const shapes = art[lighting]
    // Existing art definitions place the soft contact shadow first.
    const shadow = shapes[0]
    const hasShadow = shadow?.kind === 'ellipse' && shadow.alpha !== undefined && shadow.alpha < 1
    if (!image) {
      for (const [index, shape] of shapes.entries()) {
        const target = isForeground?.(prop.kind) && !(index === 0 && hasShadow) ? foregroundPrimitives : primitives
        target.push(translate(shape, prop))
      }
      continue
    }
    if (hasShadow) primitives.push(translate(shadow, prop))
    sprites.push({ kind: prop.kind, image, x: prop.x, y: prop.y, size: art.radius * 2 * sceneryScale(prop), rotation: sceneryRotation(prop) })
  }
  return { primitives, foregroundPrimitives, sprites }
}
