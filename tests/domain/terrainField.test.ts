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
  terrainKindIndex,
  terrainKindAt,
} from '@/domain/terrain/terrainField'

describe('terrain field', () => {
  it('indexes 14K-cell terrain lookups and invalidates the index on a brush edit', () => {
    const terrain = normalizeTerrain({
      cells: Array.from({ length: 14_000 }, (_, index) => ({
        column: (index % 140) - 70,
        row: Math.floor(index / 140) - 50,
        kind: index % 2 === 0 ? 'hill' : 'water',
      })),
    })
    const firstIndex = terrainKindIndex(terrain)
    expect(terrainKindIndex(terrain)).toBe(firstIndex)
    expect(firstIndex.size).toBe(14_000)
    expect(terrainKindAt(terrain, { x: -70 * 32 + 16, y: -50 * 32 + 16 })).toBe('hill')
    expect(terrainKindAt(terrain, { x: -69 * 32 + 16, y: -50 * 32 + 16 })).toBe('water')
    expect(terrainKindAt(terrain, { x: 50_000, y: 50_000 })).toBeUndefined()
    const edited = paintTerrain(terrain, [{ column: -70, row: -50 }], 'water')
    expect(edited).not.toBe(terrain)
    expect(terrainKindAt(edited, { x: -70 * 32 + 16, y: -50 * 32 + 16 })).toBe('water')
    expect(terrainKindAt(terrain, { x: -70 * 32 + 16, y: -50 * 32 + 16 })).toBe('hill')
  })

  it('keeps a bounded strong cache for active terrain revisions and evicts older revisions', () => {
    const revisions = Array.from({ length: 5 }, (_, i) =>
      normalizeTerrain({ cells: [{ column: i, row: 0, kind: 'water' }] }))
    const first = terrainKindIndex(revisions[0]!)
    const second = terrainKindIndex(revisions[1]!)
    const third = terrainKindIndex(revisions[2]!)
    expect(terrainKindIndex(revisions[0]!)).toBe(first)
    expect(terrainKindIndex(revisions[2]!)).toBe(third)
    // The active three revisions must not be rebuilt between gesture reads.
    expect(terrainKindIndex(revisions[1]!)).toBe(second)
    terrainKindIndex(revisions[3]!)
    terrainKindIndex(revisions[4]!)
    expect(terrainKindIndex(revisions[0]!)).not.toBe(first)
    expect(terrainKindAt(revisions[1]!, { x: 32 + 1, y: 1 })).toBe('water')
  })

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
