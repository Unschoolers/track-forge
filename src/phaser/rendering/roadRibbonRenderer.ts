import type Phaser from 'phaser'
import { roadColorsForEnvironment } from '@/presentation/environments/roadMaterials'
import { environmentRoadStrokes } from '@/presentation/environments/environmentRoadStrokes'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'
import type { RoadRibbonSample } from '@/domain/track/trackGeometry'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { buildRoadRibbonQuads, type RoadRibbonQuad } from '@/presentation/environments/roadRibbonQuads'
export { buildRoadRibbonQuads, type RoadRibbonQuad } from '@/presentation/environments/roadRibbonQuads'
import {
  groundViewportBounds,
  type GroundViewport,
  type WorldBounds,
} from '@/presentation/environments/groundTexture'

// A typical batch covers up to 768 world units at six-unit path sampling.
const RIBBON_QUADS_PER_CHUNK = 128
const MAX_RIBBON_CHUNKS = 64

export type UpdateRoadRibbonVisibility = (view: GroundViewport, paddedViewport?: WorldBounds) => void

function hex(value: string): number {
  return Number.parseInt(value.slice(1), 16)
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
  pass: 'edge' | 'road' | 'detail',
  night: boolean,
  environmentId: TrackEnvironmentId = 'grass',
  loopLength?: number,
): void {
  if (pass === 'detail') {
    for (const quad of quads) {
      for (const stroke of environmentRoadStrokes(environmentId, quad.surface, quad.from, quad.to, night, loopLength)) {
        graphics.lineStyle(stroke.width, stroke.color, stroke.alpha)
        graphics.lineBetween(stroke.start.x, stroke.start.y, stroke.end.x, stroke.end.y)
      }
    }
    return
  }
  const colorKey = pass === 'edge'
    ? (night ? 'nightEdge' : 'edge')
    : (night ? 'nightRoad' : 'road')
  let previous: SurfaceId | undefined
  for (const quad of quads) {
    if (quad.surface !== previous) {
      graphics.fillStyle(hex(roadColorsForEnvironment(quad.surface, environmentId)[colorKey]), 1)
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
  environmentId: TrackEnvironmentId = 'grass',
): void {
  const quads = buildRoadRibbonQuads(path, ribbon)
  renderRoadRibbonPass(graphics, quads, 'edge', night, environmentId)
  renderRoadRibbonPass(graphics, quads, 'road', night, environmentId)
  renderRoadRibbonPass(graphics, quads, 'detail', night, environmentId, path.closed ? path.totalLength : undefined)
}

export function validBounds({ left, top, right, bottom }: WorldBounds): boolean {
  return Number.isFinite(left) && Number.isFinite(top) &&
    Number.isFinite(right) && Number.isFinite(bottom) &&
    left <= right && top <= bottom
}

export function boundsVisible(bounds: WorldBounds | undefined, viewport: WorldBounds): boolean {
  return !validBounds(viewport) || !bounds || !validBounds(bounds) || (
    bounds.left <= viewport.right && bounds.right >= viewport.left &&
    bounds.top <= viewport.bottom && bounds.bottom >= viewport.top
  )
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
  environmentId: TrackEnvironmentId = 'grass',
): UpdateRoadRibbonVisibility | undefined {
  if (ribbon.length <= 2 * RIBBON_QUADS_PER_CHUNK) return undefined
  const quads = buildRoadRibbonQuads(path, ribbon)
  const chunkSize = Math.max(RIBBON_QUADS_PER_CHUNK, Math.ceil(quads.length / MAX_RIBBON_CHUNKS))
  const edgeChunks = []
  for (let index = 0; index < quads.length; index += chunkSize) {
    const batch = quads.slice(index, index + chunkSize)
    const bounds = ribbonChunkBounds(batch)
    const edge = scene.add.graphics().setDepth(WORLD_RENDER_DEPTH.road)
    renderRoadRibbonPass(edge, batch, 'edge', night, environmentId)
    edgeChunks.push({ batch, bounds: validBounds(bounds) ? bounds : undefined, edge })
  }
  // Phaser keeps insertion order within one depth. Paint every edge before
  // any road strip so intersecting sections look the same as the shared renderer.
  const chunks = edgeChunks.map(({ batch, bounds, edge }) => {
    const road = scene.add.graphics().setDepth(WORLD_RENDER_DEPTH.road)
    renderRoadRibbonPass(road, batch, 'road', night, environmentId)
    return { batch, bounds, edge, road }
  })
  // Keep the full painter order consistent with an unchunked ribbon:
  // all edges, then all road fills, then all subtle material strokes.
  // Separate static detail objects share the same bounded visibility window.
  const materials = chunks.map(({ batch }) => {
    const detail = scene.add.graphics().setDepth(WORLD_RENDER_DEPTH.road)
    renderRoadRibbonPass(detail, batch, 'detail', night, environmentId, path.closed ? path.totalLength : undefined)
    return detail
  })

  return (view, paddedViewport) => {
    const viewport = paddedViewport ?? groundViewportBounds(view)
    chunks.forEach(({ bounds, edge, road }, index) => {
      const visible = boundsVisible(bounds, viewport)
      if (edge.visible !== visible) {
        edge.setVisible(visible)
        road.setVisible(visible)
      }
      const detail = materials[index]
      if (detail && detail.visible !== visible) detail.setVisible(visible)
    })
  }
}
