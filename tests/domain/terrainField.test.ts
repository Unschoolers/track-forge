import { describe, expect, it } from 'vitest'
import { TERRAIN_LIMITS, WORLD_ELEVATION } from '@/domain/config'
import {
  cellsInBrush,
  EMPTY_TERRAIN,
  normalizeTerrain,
  paintTerrain,
  planTerrainPaint,
  planTerrainCellsInBrush,
  terrainCellKey,
} from '@/domain/terrain/terrainField'

describe('terrain field', () => {
  it('centralizes the fixed grid, elevation, brush, and authored-cell limits', () => {
    expect(WORLD_ELEVATION).toEqual({
      cellSize: 32,
      baseHeight: 0,
      levelHeight: 24,
      naturalSlopeRun: 24,
      roadSlopeRun: 96,
    })
    expect(TERRAIN_LIMITS).toEqual({
      minimumCoordinate: -2048,
      maximumCoordinate: 2048,
      maximumCells: 20_000,
      brushRadii: [48, 96, 160],
    })
  })

  it('normalizes bounds, kinds, duplicates, and deterministic order', () => {
    expect(normalizeTerrain({
      cellSize: 999,
      cells: [
        { column: 2, row: 1, kind: 'hill' },
        { column: 2, row: 1, kind: 'water' },
        { column: Number.NaN, row: 0, kind: 'hill' },
        { column: 4.9, row: -1.2, kind: 'hill' },
        { column: -2049, row: 0, kind: 'water' },
        { column: 0, row: 0, kind: 'lava' },
      ],
    })).toEqual({
      cellSize: 32,
      cells: [
        { column: 4, row: -1, kind: 'hill' },
        { column: 2, row: 1, kind: 'water' },
      ],
    })
  })

  it('keys coordinates and includes only cell centers inside a circular brush', () => {
    const cells = cellsInBrush({ x: 16, y: 16 }, 48)

    expect(terrainCellKey({ column: 2, row: -3 })).toBe('2:-3')
    expect(cells).toEqual([
      { column: -1, row: -1 },
      { column: 0, row: -1 },
      { column: 1, row: -1 },
      { column: -1, row: 0 },
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: -1, row: 1 },
      { column: 0, row: 1 },
      { column: 1, row: 1 },
    ])
  })

  it('paints circular raise, water, and ground brushes immutably', () => {
    const cells = cellsInBrush({ x: 16, y: 16 }, 48)
    const hill = paintTerrain(EMPTY_TERRAIN, cells, 'hill')
    const water = paintTerrain(hill, cells, 'water')
    const ground = paintTerrain(water, cells, 'ground')

    expect(hill).not.toBe(EMPTY_TERRAIN)
    expect(hill.cells.every((cell) => cell.kind === 'hill')).toBe(true)
    expect(water).not.toBe(hill)
    expect(water.cells.every((cell) => cell.kind === 'water')).toBe(true)
    expect(ground).toEqual(EMPTY_TERRAIN)
  })

  it('reuses terrain and existing cells when a brush makes no change', () => {
    const terrain = normalizeTerrain({
      cells: [{ column: 0, row: 0, kind: 'hill' }],
    })

    expect(paintTerrain(terrain, [{ column: 0, row: 0 }], 'hill')).toBe(
      terrain,
    )
    expect(paintTerrain(terrain, [], 'ground')).toBe(terrain)
  })

  it('refuses a mixed replacement and addition atomically at capacity', () => {
    const terrain = normalizeTerrain({
      cells: Array.from({ length: TERRAIN_LIMITS.maximumCells }, (_, index) => ({
        column: index % 200,
        row: Math.floor(index / 200),
        kind: 'hill',
      })),
    })

    const result = paintTerrain(
      terrain,
      [
        { column: 0, row: 0 },
        { column: 500, row: 500 },
      ],
      'water',
    )

    expect(result).toBe(terrain)
    expect(result.cells[0]?.kind).toBe('hill')
  })

  it('rejects an edge-crossing brush and invalid paint coordinates atomically', () => {
    const edgeBrush = planTerrainCellsInBrush(
      {
        x: TERRAIN_LIMITS.maximumCoordinate * WORLD_ELEVATION.cellSize + 16,
        y: 16,
      },
      48,
    )
    const terrain = normalizeTerrain({
      cells: [{ column: 0, row: 0, kind: 'hill' }],
    })
    const paint = planTerrainPaint(
      terrain,
      [
        { column: 0, row: 0 },
        { column: TERRAIN_LIMITS.maximumCoordinate + 1, row: 0 },
      ],
      'water',
    )

    expect(edgeBrush).toEqual({
      ok: false,
      reason: 'coordinate-bounds',
    })
    expect(paint).toEqual({
      ok: false,
      reason: 'coordinate-bounds',
    })
    expect(terrain.cells[0]?.kind).toBe('hill')
  })

  it('allows replacements and erasures when terrain is already at capacity', () => {
    const terrain = normalizeTerrain({
      cells: Array.from({ length: TERRAIN_LIMITS.maximumCells }, (_, index) => ({
        column: index % 200,
        row: Math.floor(index / 200),
        kind: 'hill',
      })),
    })

    const replaced = paintTerrain(
      terrain,
      [{ column: 0, row: 0 }],
      'water',
    )
    const erased = paintTerrain(
      terrain,
      [{ column: 0, row: 0 }],
      'ground',
    )

    expect(replaced.cells).toHaveLength(TERRAIN_LIMITS.maximumCells)
    expect(replaced.cells[0]?.kind).toBe('water')
    expect(erased.cells).toHaveLength(TERRAIN_LIMITS.maximumCells - 1)
  })
})
