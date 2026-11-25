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
    if (!art || prop.x + art.radius < bounds.left || prop.x - art.radius > bounds.right || prop.y + art.radius < bounds.top || prop.y - art.radius > bounds.bottom) continue
    yield { prop, art }
  }
}

function translate(shape: SceneryPrimitive, prop: SceneryProp): SceneryPrimitive {
  return shape.kind === 'ellipse'
    ? { ...shape, x: shape.x + prop.x, y: shape.y + prop.y }
    : { ...shape, points: shape.points.map(point => ({ x: point.x + prop.x, y: point.y + prop.y })) }
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
  readonly image: HTMLCanvasElement
  readonly x: number
  readonly y: number
  readonly size: number
}

/** One presentation plan for editor, race and Canvas flyover. Keep the
 * authored radius and existing contact shadow, but replace the body art.
 * Vector art remains a deterministic pre-boot/test fallback. */
export function buildSceneryRenderPlan(
  environmentId: TrackEnvironmentId, props: readonly SceneryProp[],
  lighting: LightingMode, bounds: WorldBounds,
  resolveBitmap: SceneryBitmapResolver = getSceneryBitmap,
): { readonly primitives: readonly SceneryPrimitive[]; readonly sprites: readonly SceneryBitmapSprite[] } {
  const primitives: SceneryPrimitive[] = []
  const sprites: SceneryBitmapSprite[] = []
  for (const { prop, art } of visibleScenery(environmentId, props, bounds)) {
    const image = resolveBitmap(prop.kind, lighting === 'night')
    const shapes = art[lighting]
    if (!image) {
      for (const shape of shapes) primitives.push(translate(shape, prop))
      continue
    }
    // Existing art definitions place the soft contact shadow first.
    const shadow = shapes[0]
    if (shadow?.kind === 'ellipse' && shadow.alpha !== undefined && shadow.alpha < 1) {
      primitives.push(translate(shadow, prop))
    }
    sprites.push({ kind: prop.kind, image, x: prop.x, y: prop.y, size: art.radius * 2 })
  }
  return { primitives, sprites }
}
