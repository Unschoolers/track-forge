import type Phaser from 'phaser'
import { SURFACE_SPECS } from '@/domain/config'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'
import type { RoadRibbonSample } from '@/domain/track/trackGeometry'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import {
  groundViewportBounds,
  type GroundViewport,
  type WorldBounds,
} from '@/presentation/environments/groundTexture'

// A typical batch covers up to 768 world units at six-unit path sampling.
const RIBBON_QUADS_PER_CHUNK = 128
const MAX_RIBBON_CHUNKS = 64

export type UpdateRoadRibbonVisibility = (view: GroundViewport) => void

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

function renderRoadRibbonPass(
  graphics: Phaser.GameObjects.Graphics,
  quads: readonly RoadRibbonQuad[],
  pass: 'edge' | 'road',
  night: boolean,
): void {
  const colorKey = pass === 'edge'
    ? (night ? 'nightEdge' : 'edge')
    : (night ? 'nightRoad' : 'road')
  let previous: SurfaceId | undefined
  for (const quad of quads) {
    if (quad.surface !== previous) {
      graphics.fillStyle(hex(SURFACE_SPECS[quad.surface][colorKey]), 1)
      previous = quad.surface
    }
    fillQuad(graphics, quad[pass])
  }
}

export function renderRoadRibbon(
  graphics: Phaser.GameObjects.Graphics,
  path: RoadPath,
  ribbon: readonly RoadRibbonSample[],
  night: boolean,
): void {
  const quads = buildRoadRibbonQuads(path, ribbon)
  renderRoadRibbonPass(graphics, quads, 'edge', night)
  renderRoadRibbonPass(graphics, quads, 'road', night)
}

function validBounds({ left, top, right, bottom }: WorldBounds): boolean {
  return Number.isFinite(left) && Number.isFinite(top) &&
    Number.isFinite(right) && Number.isFinite(bottom) &&
    left <= right && top <= bottom
}

function ribbonChunkBounds(quads: readonly RoadRibbonQuad[]): WorldBounds {
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity
  for (const quad of quads) {
    // Each road vertex lies between its sample's two edge vertices.
    for (const { x, y } of quad.edge) {
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  return { left, top, right, bottom }
}

/** Creates race ribbon graphics once and culls their padded world-space bounds. */
export function renderRaceRoadRibbon(
  scene: Phaser.Scene,
  path: RoadPath,
  ribbon: readonly RoadRibbonSample[],
  night: boolean,
): UpdateRoadRibbonVisibility | undefined {
  if (ribbon.length <= 2 * RIBBON_QUADS_PER_CHUNK) return undefined
  const quads = buildRoadRibbonQuads(path, ribbon)
  const chunkSize = Math.max(RIBBON_QUADS_PER_CHUNK, Math.ceil(quads.length / MAX_RIBBON_CHUNKS))
  const edgeChunks = []
  for (let index = 0; index < quads.length; index += chunkSize) {
    const batch = quads.slice(index, index + chunkSize)
    const bounds = ribbonChunkBounds(batch)
    const edge = scene.add.graphics().setDepth(WORLD_RENDER_DEPTH.road)
    renderRoadRibbonPass(edge, batch, 'edge', night)
    edgeChunks.push({ batch, bounds: validBounds(bounds) ? bounds : undefined, edge })
  }
  // Phaser keeps insertion order within one depth. Paint every edge before
  // any road strip so intersecting sections look the same as the shared renderer.
  const chunks = edgeChunks.map(({ batch, bounds, edge }) => {
    const road = scene.add.graphics().setDepth(WORLD_RENDER_DEPTH.road)
    renderRoadRibbonPass(road, batch, 'road', night)
    return { bounds, edge, road }
  })

  return (view) => {
    const viewport = groundViewportBounds(view)
    const valid = validBounds(viewport)
    for (const { bounds, edge, road } of chunks) {
      const visible = !valid || !bounds || (
        bounds.left <= viewport.right && bounds.right >= viewport.left &&
        bounds.top <= viewport.bottom && bounds.bottom >= viewport.top
      )
      if (edge.visible === visible) continue
      edge.setVisible(visible)
      road.setVisible(visible)
    }
  }
}
