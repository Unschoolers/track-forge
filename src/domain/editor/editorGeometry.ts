import { TERRAIN_LIMITS, WORLD_ELEVATION } from '@/domain/config'
import { distance } from '@/domain/geometry/math'
import type {
  SurfaceId,
  TerrainMap,
  TrackPoint,
  Tree,
  Vector2,
} from '@/domain/model'
import { terrainCellKey } from '@/domain/terrain/terrainField'

export const EDITOR_SURFACES = ['street', 'dirt', 'ice', 'mixed'] as const
export const EDITOR_TOOLS = [
  'draw',
  'select',
  'start',
  'paint',
  'structure',
  'terrain',
  'pan',
  'tree',
  'erase',
] as const
export type EditorSurface = (typeof EDITOR_SURFACES)[number]
export type EditorTool = (typeof EDITOR_TOOLS)[number]
export type EditorCameraAction = 'zoom-in' | 'zoom-out' | 'fit'

export const EDITOR_LIMITS = {
  closeDistance: 74,
  minimumPoints: 9,
  minimumTrackLength: 900,
  historyLimit: 50,
  drawGapScreenPixels: 27,
  pointHitScreenPixels: 30,
  segmentHitScreenPixels: 44,
  treeHitScreenPixels: 24,
  strokeSimplifyScreenPixels: 9,
  maximumControlGapScreenPixels: 120,
} as const

function pointLineDistance(
  point: Vector2,
  start: Vector2,
  end: Vector2,
): number {
  const x = end.x - start.x
  const y = end.y - start.y
  const lengthSquared = x * x + y * y
  if (lengthSquared === 0) return distance(point, start)
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * x + (point.y - start.y) * y) /
        lengthSquared,
    ),
  )
  return Math.hypot(
    point.x - (start.x + x * t),
    point.y - (start.y + y * t),
  )
}

function simplifyStroke(
  points: readonly TrackPoint[],
  tolerance: number,
): readonly TrackPoint[] {
  if (points.length <= 2) return points
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) return points
  let furthestIndex = -1
  let furthestDistance = tolerance
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]
    if (!point) continue
    const candidate = pointLineDistance(point, first, last)
    if (candidate > furthestDistance) {
      furthestDistance = candidate
      furthestIndex = index
    }
  }
  if (furthestIndex < 0) return [first, last]
  const left = simplifyStroke(points.slice(0, furthestIndex + 1), tolerance)
  const right = simplifyStroke(points.slice(furthestIndex), tolerance)
  return [...left.slice(0, -1), ...right]
}

function normalizeStrokeSpacing(
  points: readonly TrackPoint[],
  maximumGap: number,
): readonly TrackPoint[] {
  const first = points[0]
  if (!first) return points
  const normalized: TrackPoint[] = [first]
  for (let index = 1; index < points.length; index += 1) {
    const start = normalized.at(-1)
    const end = points[index]
    if (!start || !end) continue
    const gap = distance(start, end)
    const divisions = Math.max(1, Math.ceil(gap / maximumGap))
    for (let step = 1; step <= divisions; step += 1) {
      const ratio = step / divisions
      normalized.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        surface: ratio === 1 ? end.surface : start.surface,
      })
    }
  }
  return normalized
}

export function finalizeDrawGesture(
  points: readonly TrackPoint[],
  startIndex: number,
  zoom: number,
): readonly TrackPoint[] {
  if (points.length < 3 || startIndex >= points.length) return points
  const safeZoom = Math.max(0.01, zoom)
  const anchorIndex = Math.max(0, Math.min(points.length - 1, startIndex - 1))
  const prefix = points.slice(0, anchorIndex)
  const gesture = points.slice(anchorIndex)
  const simplified = simplifyStroke(
    gesture,
    EDITOR_LIMITS.strokeSimplifyScreenPixels / safeZoom,
  )
  const normalized = normalizeStrokeSpacing(
    simplified,
    EDITOR_LIMITS.maximumControlGapScreenPixels / safeZoom,
  )
  return [...prefix, ...normalized]
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export function surfaceForIndex(
  surface: EditorSurface,
  index: number,
): SurfaceId {
  if (surface !== 'mixed') return surface
  const surfaces = ['street', 'dirt', 'ice'] as const
  return surfaces[
    ((Math.floor(index) % surfaces.length) + surfaces.length) %
      surfaces.length
  ] ?? 'street'
}

export function appendDrawPoint(
  points: readonly TrackPoint[],
  position: Vector2,
  surface: EditorSurface,
  zoom: number,
): readonly TrackPoint[] {
  const safeZoom = Math.max(0.01, zoom)
  const last = points.at(-1)
  const nextSurface = surfaceForIndex(surface, points.length)
  if (!last) return [{ ...position, surface: nextSurface }]
  const minimumGap = EDITOR_LIMITS.drawGapScreenPixels / safeZoom
  if (distance(position, last) <= minimumGap) return points

  const previous = points.at(-2)
  if (previous) {
    const firstAngle = Math.atan2(
      last.y - previous.y,
      last.x - previous.x,
    )
    const nextAngle = Math.atan2(
      position.y - last.y,
      position.x - last.x,
    )
    const turn = Math.abs(wrapAngle(nextAngle - firstAngle))
    const deviation = pointLineDistance(last, previous, position)
    const combined = distance(previous, position)
    if (
      combined > minimumGap * 1.8 &&
      turn < 0.24 &&
      deviation < 10 / safeZoom
    ) {
      return [
        ...points.slice(0, -1),
        { ...last, x: position.x, y: position.y },
      ]
    }
  }
  return [...points, { ...position, surface: nextSurface }]
}

export function nearestControlPoint(
  points: readonly TrackPoint[],
  target: Vector2,
  zoom: number,
): number {
  const maximum = EDITOR_LIMITS.pointHitScreenPixels / Math.max(0.01, zoom)
  let nearest = -1
  let best = maximum
  points.forEach((point, index) => {
    const candidate = distance(point, target)
    if (candidate < best) {
      best = candidate
      nearest = index
    }
  })
  return nearest
}

export function nearestTree(
  trees: readonly Tree[],
  target: Vector2,
  zoom: number,
): number {
  const maximum = EDITOR_LIMITS.treeHitScreenPixels / Math.max(0.01, zoom)
  let nearest = -1
  let best = maximum
  trees.forEach((tree, index) => {
    const candidate = distance(tree, target)
    if (candidate < best) {
      best = candidate
      nearest = index
    }
  })
  return nearest
}

export function nearestSegmentIndex(
  points: readonly TrackPoint[],
  target: Vector2,
  zoom: number,
): number {
  const maximum =
    EDITOR_LIMITS.segmentHitScreenPixels / Math.max(0.01, zoom)
  let nearest = -1
  let best = maximum
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (!start || !end) continue
    const candidate = pointLineDistance(target, start, end)
    if (candidate < best) {
      best = candidate
      nearest = index
    }
  }
  return nearest
}

export function normalizeClosedLoop(
  points: readonly TrackPoint[],
): readonly TrackPoint[] {
  if (points.length < EDITOR_LIMITS.minimumPoints) return points
  const first = points[0]
  const last = points.at(-1)
  if (
    !first ||
    !last ||
    distance(first, last) >= EDITOR_LIMITS.closeDistance ||
    (first.x === last.x && first.y === last.y)
  ) {
    return points
  }
  return [
    ...points.slice(0, -1),
    { ...last, x: first.x, y: first.y },
  ]
}

export function expandAroundBoundsCenter(
  points: readonly TrackPoint[],
  trees: readonly Tree[],
  factor: 2,
): { readonly points: readonly TrackPoint[]; readonly trees: readonly Tree[] } {
  const content: readonly Vector2[] = [...points, ...trees]
  if (content.length === 0) return { points, trees }
  const center = boundsCenter(content)
  const expand = <T extends Vector2>(item: T): T => ({
    ...item,
    x: center.x + (item.x - center.x) * factor,
    y: center.y + (item.y - center.y) * factor,
  })
  return {
    points: points.map(expand),
    trees: trees.map(expand),
  }
}

/**
 * Scales sparse terrain footprints with the same bounds-centred transform as
 * roads and trees. A transformed cell is rasterized by target-cell centers in
 * its half-open world rectangle, preserving the 2× authored terrain area.
 */
export function expandTerrainAroundBoundsCenter(
  points: readonly TrackPoint[],
  trees: readonly Tree[],
  terrain: TerrainMap,
  factor: 2,
): TerrainMap {
  const plan = planTerrainExpansionAroundBoundsCenter(
    points,
    trees,
    terrain,
    factor,
  )
  return plan.ok ? plan.terrain : terrain
}

export type TerrainExpansionPlan =
  | { readonly ok: true; readonly terrain: TerrainMap }
  | {
      readonly ok: false
      readonly reason: 'coordinate-bounds' | 'maximum-cells'
    }

export function planTerrainExpansionAroundBoundsCenter(
  points: readonly TrackPoint[],
  trees: readonly Tree[],
  terrain: TerrainMap,
  factor: 2,
): TerrainExpansionPlan {
  const content: readonly Vector2[] = [...points, ...trees]
  if (content.length === 0 || terrain.cells.length === 0) {
    return { ok: true, terrain }
  }

  const center = boundsCenter(content)
  const source = terrain
  const cellSize = source.cellSize
  const halfCell = cellSize / 2
  const cellsByKey = new Map<string, TerrainMap['cells'][number]>()

  for (const sourceCell of source.cells) {
    const left = center.x + (sourceCell.column * cellSize - center.x) * factor
    const right =
      center.x + ((sourceCell.column + 1) * cellSize - center.x) * factor
    const top = center.y + (sourceCell.row * cellSize - center.y) * factor
    const bottom =
      center.y + ((sourceCell.row + 1) * cellSize - center.y) * factor
    const minimumColumn = Math.ceil((Math.min(left, right) - halfCell) / cellSize)
    const maximumColumn =
      Math.ceil((Math.max(left, right) - halfCell) / cellSize) - 1
    const minimumRow = Math.ceil((Math.min(top, bottom) - halfCell) / cellSize)
    const maximumRow = Math.ceil((Math.max(top, bottom) - halfCell) / cellSize) - 1

    for (let row = minimumRow; row <= maximumRow; row += 1) {
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        if (
          column < TERRAIN_LIMITS.minimumCoordinate ||
          column > TERRAIN_LIMITS.maximumCoordinate ||
          row < TERRAIN_LIMITS.minimumCoordinate ||
          row > TERRAIN_LIMITS.maximumCoordinate
        ) {
          return { ok: false, reason: 'coordinate-bounds' }
        }
        const cell = { column, row, kind: sourceCell.kind }
        cellsByKey.set(terrainCellKey(cell), cell)
        if (cellsByKey.size > TERRAIN_LIMITS.maximumCells) {
          return { ok: false, reason: 'maximum-cells' }
        }
      }
    }
  }

  return {
    ok: true,
    terrain: {
      cellSize: WORLD_ELEVATION.cellSize,
      cells: [...cellsByKey.values()].sort(
        (left, right) =>
          left.row - right.row || left.column - right.column,
      ),
    },
  }
}

function boundsCenter(content: readonly Vector2[]): Vector2 {
  const xValues = content.map((item) => item.x)
  const yValues = content.map((item) => item.y)
  return {
    x: (Math.min(...xValues) + Math.max(...xValues)) / 2,
    y: (Math.min(...yValues) + Math.max(...yValues)) / 2,
  }
}
