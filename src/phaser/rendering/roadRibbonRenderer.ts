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

/**
 * Draw two fixed triangles instead of running Phaser's polygon tessellator
 * for every six-unit road segment. These are simple ruled ribbon quads.
 */
function fillQuad(
  graphics: Phaser.GameObjects.Graphics,
  points: readonly [Vector2, Vector2, Vector2, Vector2],
): void {
  const [a, b, c, d] = points
  graphics.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y)
  graphics.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y)
}


export function renderRoadRibbon(
  graphics: Phaser.GameObjects.Graphics,
  path: RoadPath,
  ribbon: readonly RoadRibbonSample[],
  night: boolean,
): void {
  const quads = buildRoadRibbonQuads(path, ribbon)
  // Preserve the edge-under-road draw order but avoid thousands of redundant
  // fill-state changes on long tracks with uninterrupted surface types.
  let previousEdge: SurfaceId | undefined
  for (const quad of quads) {
    if (quad.surface !== previousEdge) {
      const spec = SURFACE_SPECS[quad.surface]
      graphics.fillStyle(hex(night ? spec.nightEdge : spec.edge), 1)
      previousEdge = quad.surface
    }
    fillQuad(graphics, quad.edge)
  }
  let previousRoad: SurfaceId | undefined
  for (const quad of quads) {
    if (quad.surface !== previousRoad) {
      const spec = SURFACE_SPECS[quad.surface]
      graphics.fillStyle(hex(night ? spec.nightRoad : spec.road), 1)
      previousRoad = quad.surface
    }
    fillQuad(graphics, quad.road)
  }
}

