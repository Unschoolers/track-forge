import type { LightingMode } from '@/domain/model'
import type { SceneryProp, TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { getTrackEnvironment } from './index'
import type { WorldBounds } from './groundTexture'
import type { SceneryPrimitive } from './types'

export function buildSceneryPresentation(environmentId: TrackEnvironmentId, props: readonly SceneryProp[], lighting: LightingMode, bounds: WorldBounds): readonly SceneryPrimitive[] {
  const scenery = getTrackEnvironment(environmentId).scenery
  const result: SceneryPrimitive[] = []
  for (const prop of props) {
    const art = scenery[prop.kind]
    if (!art || prop.x + art.radius < bounds.left || prop.x - art.radius > bounds.right || prop.y + art.radius < bounds.top || prop.y - art.radius > bounds.bottom) continue
    for (const shape of art[lighting]) {
      result.push(shape.kind === 'ellipse'
        ? { ...shape, x: shape.x + prop.x, y: shape.y + prop.y }
        : { ...shape, points: shape.points.map((point) => ({ x: point.x + prop.x, y: point.y + prop.y })) })
    }
  }
  return result
}
