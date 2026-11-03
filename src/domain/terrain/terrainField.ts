import {
  TERRAIN_LIMITS,
  WORLD_ELEVATION,
  type TerrainBrushRadius,
} from '@/domain/config'
import { TERRAIN_KINDS, type TerrainBrushKind, type TerrainCell, type TerrainKind, type TerrainMap, type Vector2 } from '@/domain/model'

export interface TerrainCellCoordinate {
  readonly column: number
  readonly row: number
}

export type TerrainPaintPlan =
  | {
      readonly ok: true
      readonly terrain: TerrainMap
      readonly changedCells: readonly TerrainCellCoordinate[]
    }
  | {
      readonly ok: false
      readonly reason: 'coordinate-bounds' | 'maximum-cells'
    }

export type TerrainBrushCellPlan =
  | {
      readonly ok: true
      readonly cells: readonly TerrainCellCoordinate[]
    }
  | {
      readonly ok: false
      readonly reason: 'coordinate-bounds'
    }

export const EMPTY_TERRAIN: TerrainMap = {
  cellSize: WORLD_ELEVATION.cellSize,
  cells: [],
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function coordinate(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized >= TERRAIN_LIMITS.minimumCoordinate &&
    normalized <= TERRAIN_LIMITS.maximumCoordinate
    ? normalized
    : undefined
}

function terrainKind(value: unknown): TerrainKind | undefined {
  return typeof value === 'string' && TERRAIN_KINDS.includes(value as TerrainKind)
    ? value as TerrainKind
    : undefined
}

function compareCells(left: TerrainCellCoordinate, right: TerrainCellCoordinate): number {
  return left.row - right.row || left.column - right.column
}

function asCoordinate(value: unknown): TerrainCellCoordinate | undefined {
  const item = record(value)
  if (!item) return undefined
  const column = coordinate(item.column)
  const row = coordinate(item.row)
  return column === undefined || row === undefined ? undefined : { column, row }
}

/** Creates a stable key for one normalized terrain-grid coordinate. */
export function terrainCellKey(cell: TerrainCellCoordinate): string {
  return `${cell.column}:${cell.row}`
}

/** Returns the authored kind at one finite world position, if any. */
export function terrainKindAt(
  terrain: TerrainMap,
  position: Vector2,
): TerrainKind | undefined {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return undefined
  }
  const coordinate = {
    column: Math.floor(position.x / terrain.cellSize),
    row: Math.floor(position.y / terrain.cellSize),
  }
  const key = terrainCellKey(coordinate)
  return terrain.cells.find((cell) => terrainCellKey(cell) === key)?.kind
}

/**
 * Converts untrusted persisted terrain into the canonical sparse field. Ground
 * is implicit, so invalid data and omitted cells never allocate grid storage.
 */
export function normalizeTerrain(value: unknown): TerrainMap {
  const input = record(value)
  const rawCells = input && Array.isArray(input.cells) ? input.cells : []
  const cellsByKey = new Map<string, TerrainCell>()

  for (const rawCell of rawCells) {
    const item = record(rawCell)
    if (!item) continue
    const position = asCoordinate(item)
    const kind = terrainKind(item.kind)
    if (!position || !kind) continue

    const key = terrainCellKey(position)
    if (
      !cellsByKey.has(key) &&
      cellsByKey.size >= TERRAIN_LIMITS.maximumCells
    ) {
      continue
    }
    cellsByKey.set(key, { ...position, kind })
  }

  if (cellsByKey.size === 0) return EMPTY_TERRAIN
  return {
    cellSize: WORLD_ELEVATION.cellSize,
    cells: [...cellsByKey.values()].sort(compareCells),
  }
}

/**
 * Returns bounded grid cells whose world-space centers lie within a supported
 * circular editor brush. Iteration is row-then-column for deterministic input.
 */
export function cellsInBrush(
  center: Vector2,
  radius: number,
): readonly TerrainCellCoordinate[] {
  const plan = planTerrainCellsInBrush(center, radius)
  return plan.ok ? plan.cells : []
}

export function planTerrainCellsInBrush(
  center: Vector2,
  radius: number,
): TerrainBrushCellPlan {
  if (
    !Number.isFinite(center.x) ||
    !Number.isFinite(center.y) ||
    !TERRAIN_LIMITS.brushRadii.includes(radius as TerrainBrushRadius)
  ) {
    return { ok: false, reason: 'coordinate-bounds' }
  }

  const { cellSize } = WORLD_ELEVATION
  const halfCell = cellSize / 2
  const minimumColumn = Math.ceil(
    (center.x - radius - halfCell) / cellSize,
  )
  const maximumColumn = Math.floor(
    (center.x + radius - halfCell) / cellSize,
  )
  const minimumRow = Math.ceil((center.y - radius - halfCell) / cellSize)
  const maximumRow = Math.floor((center.y + radius - halfCell) / cellSize)
  if (
    minimumColumn < TERRAIN_LIMITS.minimumCoordinate ||
    maximumColumn > TERRAIN_LIMITS.maximumCoordinate ||
    minimumRow < TERRAIN_LIMITS.minimumCoordinate ||
    maximumRow > TERRAIN_LIMITS.maximumCoordinate
  ) {
    return { ok: false, reason: 'coordinate-bounds' }
  }
  const radiusSquared = radius * radius
  const cells: TerrainCellCoordinate[] = []

  for (let row = minimumRow; row <= maximumRow; row += 1) {
    for (let column = minimumColumn; column <= maximumColumn; column += 1) {
      const cellCenterX = column * cellSize + halfCell
      const cellCenterY = row * cellSize + halfCell
      const offsetX = cellCenterX - center.x
      const offsetY = cellCenterY - center.y
      if (offsetX * offsetX + offsetY * offsetY <= radiusSquared) {
        cells.push({ column, row })
      }
    }
  }
  return { ok: true, cells }
}

/**
 * Applies one immutable terrain brush. Existing terrain cells are retained by
 * reference whenever their kind is unchanged, and no-op strokes retain the
 * original terrain map for editor history and rendering caches.
 */
export function planTerrainPaint(
  terrain: TerrainMap,
  positions: readonly TerrainCellCoordinate[],
  kind: TerrainBrushKind,
): TerrainPaintPlan {
  if (kind !== 'ground' && !terrainKind(kind)) {
    return { ok: true, terrain, changedCells: [] }
  }

  const cellsByKey = new Map<string, TerrainCell>()
  for (const cell of terrain.cells) {
    cellsByKey.set(terrainCellKey(cell), cell)
  }

  let changed = false
  const changedCellsByKey = new Map<string, TerrainCellCoordinate>()
  for (const positionInput of positions) {
    const position = asCoordinate(positionInput)
    if (!position) {
      return { ok: false, reason: 'coordinate-bounds' }
    }
    const key = terrainCellKey(position)
    const current = cellsByKey.get(key)

    if (kind === 'ground') {
      if (current) {
        cellsByKey.delete(key)
        changed = true
        changedCellsByKey.set(key, position)
      }
      continue
    }

    if (current?.kind === kind) continue
    if (!current && cellsByKey.size >= TERRAIN_LIMITS.maximumCells) {
      return { ok: false, reason: 'maximum-cells' }
    }
    cellsByKey.set(key, { ...position, kind })
    changed = true
    changedCellsByKey.set(key, position)
  }

  if (!changed) return { ok: true, terrain, changedCells: [] }
  return {
    ok: true,
    terrain:
      cellsByKey.size === 0
        ? EMPTY_TERRAIN
        : {
            cellSize: WORLD_ELEVATION.cellSize,
            cells: [...cellsByKey.values()].sort(compareCells),
          },
    changedCells: [...changedCellsByKey.values()].sort(compareCells),
  }
}

export function paintTerrain(
  terrain: TerrainMap,
  positions: readonly TerrainCellCoordinate[],
  kind: TerrainBrushKind,
): TerrainMap {
  const plan = planTerrainPaint(terrain, positions, kind)
  return plan.ok ? plan.terrain : terrain
}
