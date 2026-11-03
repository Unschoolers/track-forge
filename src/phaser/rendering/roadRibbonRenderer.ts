import type Phaser from 'phaser'
import { SURFACE_SPECS } from '@/domain/config'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'
import type { RoadRibbonSample } from '@/domain/track/trackGeometry'

export interface RoadRibbonQuad {
  readonly surface: SurfaceId
  readonly edge: readonly [Vector2, Vector2, Vector2, Vector2]
  readonly road: readonly [Vector2, Vector2, Vector2, Vector2]
}

function hex(value: string): number {
  return Number.parseInt(value.slice(1), 16)
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

function fillPolygon(
  graphics: Phaser.GameObjects.Graphics,
  points: readonly [Vector2, Vector2, Vector2, Vector2],
  color: number,
): void {
  graphics.fillStyle(color, 1)
  graphics.beginPath()
  graphics.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) graphics.lineTo(point.x, point.y)
  graphics.closePath()
  graphics.fillPath()
}

export function renderRoadRibbon(
  graphics: Phaser.GameObjects.Graphics,
  path: RoadPath,
  ribbon: readonly RoadRibbonSample[],
  night: boolean,
): void {
  const quads = buildRoadRibbonQuads(path, ribbon)
  for (const quad of quads) {
    const spec = SURFACE_SPECS[quad.surface]
    fillPolygon(graphics, quad.edge, hex(night ? spec.nightEdge : spec.edge))
  }
  for (const quad of quads) {
    const spec = SURFACE_SPECS[quad.surface]
    fillPolygon(graphics, quad.road, hex(night ? spec.nightRoad : spec.road))
  }
}

