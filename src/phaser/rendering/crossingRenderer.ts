import type Phaser from 'phaser'
import { SURFACE_SPECS } from '@/domain/config'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'

export interface JunctionPrimitive {
  readonly kind: 'junction'
  readonly polygon: readonly Vector2[]
  readonly surface: SurfaceId
}

export function buildCrossingPresentation(
  path: RoadPath,
): readonly JunctionPrimitive[] {
  return path.crossings.flatMap((crossing) => {
    const point = path.points[crossing.firstPathIndex]
    return crossing.upperSegment === null && point
      ? [{
          kind: 'junction' as const,
          polygon: crossing.polygon,
          surface: point.surface,
        }]
      : []
  })
}

function color(value: string): number {
  return Number.parseInt(value.slice(1), 16)
}

export function renderCrossingUnderlay(
  graphics: Phaser.GameObjects.Graphics,
  path: RoadPath,
  night: boolean,
): void {
  for (const junction of buildCrossingPresentation(path)) {
    const spec = SURFACE_SPECS[junction.surface]
    graphics.fillStyle(color(night ? spec.nightRoad : spec.road), 1)
    graphics.beginPath()
    const first = junction.polygon[0]
    if (!first) continue
    graphics.moveTo(first.x, first.y)
    for (const point of junction.polygon.slice(1)) {
      graphics.lineTo(point.x, point.y)
    }
    graphics.closePath()
    graphics.fillPath()
  }
}
