import type { SurfaceId, Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'
import type { RoadRibbonSample } from '@/domain/track/trackGeometry'

export interface RoadRibbonQuad {
  readonly surface: SurfaceId
  readonly from: RoadRibbonSample['center']
  readonly to: RoadRibbonSample['center']
  readonly edge: readonly [Vector2, Vector2, Vector2, Vector2]
  readonly road: readonly [Vector2, Vector2, Vector2, Vector2]
}

export function buildRoadRibbonQuads(
  path: RoadPath,
  ribbon: readonly RoadRibbonSample[],
): readonly RoadRibbonQuad[] {
  const count = path.closed ? ribbon.length : ribbon.length - 1
  const quads: RoadRibbonQuad[] = []
  for (let index = 0; index < count; index += 1) {
    const current = ribbon[index]
    const next = ribbon[(index + 1) % ribbon.length]
    if (!current || !next) continue
    quads.push({
      surface: current.surface,
      from: current.center,
      to: path.closed && index === count - 1 ? { ...next.center, distance: path.totalLength } : next.center,
      edge: [
        current.edgeLeft,
        next.edgeLeft,
        next.edgeRight,
        current.edgeRight,
      ],
      road: [current.left, next.left, next.right, current.right],
    })
  }
  return quads
}

