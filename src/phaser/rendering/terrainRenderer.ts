import type Phaser from 'phaser'
import { WORLD_ELEVATION } from '@/domain/config'
import type { Vector2 } from '@/domain/model'
import type { TerrainSurface } from '@/domain/terrain/terrainSurface'
import type { TerrainPreview } from '@/phaser/input/editorInput'
import {
  buildTerrainPresentation,
} from '@/phaser/rendering/terrainMesh'
import type {
  TerrainPreviewBounds,
  TerrainPreviewRoadSegment,
} from '@/phaser/rendering/terrainPreview'
import {
  terrainPreviewSegmentIntersectsBounds,
} from '@/phaser/rendering/terrainPreview'
import type {
  TerrainTriangle,
} from '@/phaser/rendering/terrainTopology'

export {
  buildTerrainPresentation,
  compileTerrainPresentation,
  TERRAIN_PRESENTATION_LIMITS,
  TerrainPresentationBudgetError,
  type TerrainPresentation,
  type TerrainPresentationStats,
  type TerrainPrimitive,
} from '@/phaser/rendering/terrainMesh'

function fillTriangle(
  graphics: Phaser.GameObjects.Graphics,
  triangle: TerrainTriangle,
): void {
  graphics.fillTriangle(
    triangle[0].x,
    triangle[0].y,
    triangle[1].x,
    triangle[1].y,
    triangle[2].x,
    triangle[2].y,
  )
}

function strokeRing(
  graphics: Phaser.GameObjects.Graphics,
  ring: readonly Vector2[],
): void {
  const first = ring[0]
  if (!first) return
  graphics.beginPath()
  graphics.moveTo(first.x, first.y)
  for (const point of ring.slice(1)) graphics.lineTo(point.x, point.y)
  graphics.closePath()
  graphics.strokePath()
}

export function renderTerrain(
  graphics: Phaser.GameObjects.Graphics,
  surface: TerrainSurface,
  night: boolean,
): void {
  for (const primitive of buildTerrainPresentation(surface)) {
    switch (primitive.kind) {
      case 'water':
        graphics.fillStyle(night ? 0x183f52 : 0x287c9c, 1)
        for (const triangle of primitive.triangles) {
          fillTriangle(graphics, triangle)
        }
        graphics.lineStyle(1.25, night ? 0x6c9baa : 0x9bd8e8, 0.34)
        for (const line of primitive.texture) {
          graphics.lineBetween(
            line.start.x,
            line.start.y,
            line.end.x,
            line.end.y,
          )
        }
        break
      case 'shoreline':
        graphics.lineStyle(3.5, night ? 0x59715f : 0x83a764, 0.9)
        for (const ring of primitive.rings) strokeRing(graphics, ring)
        graphics.lineStyle(1.2, night ? 0x7eb4c1 : 0xc1edf2, 0.75)
        for (const ring of primitive.rings) strokeRing(graphics, ring)
        break
      case 'hill-shadow':
        graphics.fillStyle(0x08120d, night ? 0.16 : 0.24)
        for (const triangle of primitive.triangles) {
          fillTriangle(graphics, triangle)
        }
        break
      case 'hill-slope': {
        const base = night ? 0x1b452a : 0x398858
        for (const facet of primitive.facets) {
          const alpha = 0.82 + facet.shade * 0.1
          graphics.fillStyle(
            base,
            Math.max(0.65, Math.min(0.95, alpha)),
          )
          fillTriangle(graphics, facet.triangle)
        }
        break
      }
      case 'hill-plateau':
        graphics.fillStyle(night ? 0x235433 : 0x4c9d63, 1)
        for (const triangle of primitive.triangles) {
          fillTriangle(graphics, triangle)
        }
        break
    }
  }
}

export function renderTerrainPreview(
  graphics: Phaser.GameObjects.Graphics,
  preview: TerrainPreview | null,
  night: boolean,
): void {
  if (!preview) return
  const color =
    preview.kind === 'water'
      ? night ? 0x5ca7c2 : 0x2f9fc6
      : preview.kind === 'hill'
        ? night ? 0x8cb873 : 0x72bd68
        : night ? 0xd6c99e : 0xe4d8ad
  const { cellSize } = WORLD_ELEVATION

  graphics.fillStyle(color, 0.2)
  for (const cell of preview.cells) {
    graphics.fillRect(
      cell.column * cellSize,
      cell.row * cellSize,
      cellSize,
      cellSize,
    )
  }
  graphics.lineStyle(3, color, 0.92)
  graphics.strokeCircle(
    preview.position.x,
    preview.position.y,
    preview.radius,
  )
  graphics.fillStyle(color, 0.9)
  graphics.fillCircle(preview.position.x, preview.position.y, 3)
}

/**
 * Renders a bounded candidate terrain surface without duplicating topology
 * compilation. The alpha treatment keeps committed terrain readable while
 * exposing the shoreline, hill profile, and affected canonical road grades.
 */
export function renderTerrainImpactPreview(
  graphics: Phaser.GameObjects.Graphics,
  surface: TerrainSurface,
  roadSegments: readonly TerrainPreviewRoadSegment[],
  night: boolean,
  bounds: TerrainPreviewBounds,
): void {
  const fillPreviewTriangle = (triangle: TerrainTriangle): void => {
    const xs = triangle.map((point) => point.x)
    const ys = triangle.map((point) => point.y)
    if (
      Math.max(...xs) < bounds.left ||
      Math.min(...xs) > bounds.right ||
      Math.max(...ys) < bounds.top ||
      Math.min(...ys) > bounds.bottom
    ) {
      return
    }
    fillTriangle(graphics, triangle)
  }

  for (const primitive of buildTerrainPresentation(surface)) {
    switch (primitive.kind) {
      case 'water':
        graphics.fillStyle(night ? 0x5ca7c2 : 0x2f9fc6, 0.28)
        for (const triangle of primitive.triangles) {
          fillPreviewTriangle(triangle)
        }
        break
      case 'shoreline':
        break
      case 'hill-shadow':
        graphics.fillStyle(0x08120d, night ? 0.1 : 0.14)
        for (const triangle of primitive.triangles) {
          fillPreviewTriangle(triangle)
        }
        break
      case 'hill-slope':
        for (const facet of primitive.facets) {
          graphics.fillStyle(night ? 0x8cb873 : 0x72bd68, 0.22)
          fillPreviewTriangle(facet.triangle)
        }
        break
      case 'hill-plateau':
        graphics.fillStyle(night ? 0x8cb873 : 0x72bd68, 0.28)
        for (const triangle of primitive.triangles) {
          fillPreviewTriangle(triangle)
        }
        break
    }
  }

  for (const contour of surface.contours) {
    const color =
      contour.kind === 'water'
        ? night ? 0x9bd8e8 : 0x287c9c
        : night ? 0xb1d19f : 0x397a43
    graphics.lineStyle(2.5, color, 0.86)
    for (let index = 0; index < contour.points.length; index += 1) {
      const start = contour.points[index]
      const end = contour.points[(index + 1) % contour.points.length]
      if (
        !start ||
        !end ||
        !terrainPreviewSegmentIntersectsBounds(start, end, bounds)
      ) {
        continue
      }
      graphics.lineBetween(start.x, start.y, end.x, end.y)
    }
  }

  for (const segment of roadSegments) {
    const steepening = Math.abs(segment.gradeDelta) > 0.000_1
    const color = steepening
      ? night ? 0xffc36c : 0xc96618
      : night ? 0xd6c99e : 0x6f5b2e
    const alpha = Math.min(
      1,
      0.72 + Math.abs(segment.grade) * 4 + Math.abs(segment.heightDelta) / 24,
    )
    graphics.lineStyle(5, color, alpha)
    graphics.lineBetween(
      segment.start.x,
      segment.start.y,
      segment.end.x,
      segment.end.y,
    )
  }
}
