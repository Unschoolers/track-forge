import {
  ROAD_GEOMETRY,
  TERRAIN_LIMITS,
  WORLD_ELEVATION,
} from '@/domain/config'
import type { TerrainMap, Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'
import type { TerrainPreview } from '@/phaser/input/editorInput'

const regionCellSpan = 8
const impactPaddingCells = 1
const paddingCells =
  Math.ceil(
    (WORLD_ELEVATION.roadSlopeRun + ROAD_GEOMETRY.edgeWidth) /
      WORLD_ELEVATION.cellSize,
  ) + 1

export const TERRAIN_PREVIEW_LIMITS = {
  regionCellSpan,
  impactPaddingCells,
  paddingCells,
  maximumRegions: 8,
  maximumCellsPerRegion:
    (regionCellSpan + (paddingCells + impactPaddingCells) * 2) ** 2,
} as const

export interface TerrainPreviewBounds {
  readonly minimumColumn: number
  readonly maximumColumn: number
  readonly minimumRow: number
  readonly maximumRow: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export interface TerrainPreviewRegion {
  readonly terrain: TerrainMap
  readonly bounds: TerrainPreviewBounds
  readonly terrainBounds: TerrainPreviewBounds
}

export interface TerrainPreviewRoadSegment {
  readonly start: Vector2
  readonly end: Vector2
  readonly grade: number
  readonly gradeDelta: number
  readonly heightDelta: number
}

interface DirtyBucket {
  minimumColumn: number
  maximumColumn: number
  minimumRow: number
  maximumRow: number
}

function bucketCoordinate(value: number): number {
  return Math.floor(value / TERRAIN_PREVIEW_LIMITS.regionCellSpan)
}

function worldBounds(
  bucket: DirtyBucket,
  padding: number,
): TerrainPreviewBounds {
  const minimumColumn = Math.max(
    TERRAIN_LIMITS.minimumCoordinate,
    bucket.minimumColumn - padding,
  )
  const maximumColumn = Math.min(
    TERRAIN_LIMITS.maximumCoordinate,
    bucket.maximumColumn + padding,
  )
  const minimumRow = Math.max(
    TERRAIN_LIMITS.minimumCoordinate,
    bucket.minimumRow - padding,
  )
  const maximumRow = Math.min(
    TERRAIN_LIMITS.maximumCoordinate,
    bucket.maximumRow + padding,
  )
  return {
    minimumColumn,
    maximumColumn,
    minimumRow,
    maximumRow,
    left: minimumColumn * WORLD_ELEVATION.cellSize,
    right: (maximumColumn + 1) * WORLD_ELEVATION.cellSize,
    top: minimumRow * WORLD_ELEVATION.cellSize,
    bottom: (maximumRow + 1) * WORLD_ELEVATION.cellSize,
  }
}

function containsCell(
  bounds: TerrainPreviewBounds,
  cell: { readonly column: number; readonly row: number },
): boolean {
  return (
    cell.column >= bounds.minimumColumn &&
    cell.column <= bounds.maximumColumn &&
    cell.row >= bounds.minimumRow &&
    cell.row <= bounds.maximumRow
  )
}

/**
 * Builds a small set of candidate terrain windows around only the cells added
 * by the latest preview revision. The complete stroke remains on the preview
 * for exact cell rendering, while mesh compilation stays spatially bounded.
 */
export function buildTerrainPreviewRegions(
  preview: Pick<TerrainPreview, 'dirtyCells' | 'position' | 'terrain'>,
): readonly TerrainPreviewRegion[] {
  const buckets = new Map<string, DirtyBucket>()
  for (const cell of preview.dirtyCells) {
    const bucketColumn = bucketCoordinate(cell.column)
    const bucketRow = bucketCoordinate(cell.row)
    const key = `${bucketColumn}:${bucketRow}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.minimumColumn = Math.min(bucket.minimumColumn, cell.column)
      bucket.maximumColumn = Math.max(bucket.maximumColumn, cell.column)
      bucket.minimumRow = Math.min(bucket.minimumRow, cell.row)
      bucket.maximumRow = Math.max(bucket.maximumRow, cell.row)
    } else {
      buckets.set(key, {
        minimumColumn: cell.column,
        maximumColumn: cell.column,
        minimumRow: cell.row,
        maximumRow: cell.row,
      })
    }
  }
  const cursorColumn = preview.position.x / WORLD_ELEVATION.cellSize
  const cursorRow = preview.position.y / WORLD_ELEVATION.cellSize
  return [...buckets.values()]
    .sort((left, right) => {
      const leftDistance = Math.hypot(
        (left.minimumColumn + left.maximumColumn) / 2 - cursorColumn,
        (left.minimumRow + left.maximumRow) / 2 - cursorRow,
      )
      const rightDistance = Math.hypot(
        (right.minimumColumn + right.maximumColumn) / 2 - cursorColumn,
        (right.minimumRow + right.maximumRow) / 2 - cursorRow,
      )
      return leftDistance - rightDistance
    })
    .slice(0, TERRAIN_PREVIEW_LIMITS.maximumRegions)
    .map((bucket) => {
      const bounds = worldBounds(
        bucket,
        TERRAIN_PREVIEW_LIMITS.impactPaddingCells,
      )
      const terrainBounds = worldBounds(
        bucket,
        TERRAIN_PREVIEW_LIMITS.impactPaddingCells +
          TERRAIN_PREVIEW_LIMITS.paddingCells,
      )
      return {
        bounds,
        terrainBounds,
        terrain: {
          cellSize: WORLD_ELEVATION.cellSize,
          cells: preview.terrain.cells.filter((cell) =>
            containsCell(terrainBounds, cell),
          ),
        },
      }
    })
}

export function terrainPreviewSegmentIntersectsBounds(
  start: Vector2,
  end: Vector2,
  bounds: TerrainPreviewBounds,
): boolean {
  return !(
    Math.max(start.x, end.x) < bounds.left ||
    Math.min(start.x, end.x) > bounds.right ||
    Math.max(start.y, end.y) < bounds.top ||
    Math.min(start.y, end.y) > bounds.bottom
  )
}

/** Uses canonical composed road profiles to expose only changed local grades. */
export function buildTerrainPreviewRoadSegments(
  committed: RoadPath,
  candidate: RoadPath,
  bounds: TerrainPreviewBounds,
): readonly TerrainPreviewRoadSegment[] {
  const segments: TerrainPreviewRoadSegment[] = []
  for (let index = 0; index < candidate.points.length - 1; index += 1) {
    const start = candidate.points[index]
    const end = candidate.points[index + 1]
    if (
      !start ||
      !end ||
      !terrainPreviewSegmentIntersectsBounds(start, end, bounds)
    ) {
      continue
    }
    const before = committed.roadSurface.at(index)
    const after = candidate.roadSurface.at(index)
    const gradeDelta = after.grade - before.grade
    const heightDelta = after.height - before.height
    if (
      Math.abs(gradeDelta) <= 0.000_1 &&
      Math.abs(heightDelta) <= 0.000_1
    ) {
      continue
    }
    segments.push({
      start,
      end,
      grade: after.grade,
      gradeDelta,
      heightDelta,
    })
  }
  return segments
}
