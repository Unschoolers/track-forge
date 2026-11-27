import { describe, expect, it } from 'vitest'
import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import type { TerrainCell, Vector2 } from '@/domain/model'
import {
  compileTerrainSurface,
  type TerrainSurface,
} from '@/domain/terrain/terrainSurface'
import {
  EMPTY_TERRAIN,
  paintTerrain,
} from '@/domain/terrain/terrainField'

function rectangle(
  minimumColumn: number,
  maximumColumn: number,
  minimumRow: number,
  maximumRow: number,
): readonly Pick<TerrainCell, 'column' | 'row'>[] {
  const cells: Pick<TerrainCell, 'column' | 'row'>[] = []
  for (let row = minimumRow; row <= maximumRow; row += 1) {
    for (let column = minimumColumn; column <= maximumColumn; column += 1) {
      cells.push({ column, row })
    }
  }
  return cells
}

function compile(
  terrain = EMPTY_TERRAIN,
  centerPath: readonly Vector2[] = [],
): TerrainSurface {
  return compileTerrainSurface(terrain, centerPath)
}

function signedArea(points: readonly Vector2[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    if (!current || !next) continue
    area += current.x * next.y - next.x * current.y
  }
  return area / 2
}

describe('compiled terrain surface', () => {
  it('compacts long hill and water contours without changing holes or authored cells', () => {
    const hill = paintTerrain(EMPTY_TERRAIN, rectangle(0, 79, 0, 59), 'hill')
    const terrain = paintTerrain(hill, rectangle(20, 29, 20, 29), 'water')
    const surface = compile(terrain)
    const hills = surface.contours.filter(contour => contour.kind === 'hill')
    const lakes = surface.contours.filter(contour => contour.kind === 'water')

    expect(terrain.cells).toHaveLength(80 * 60)
    expect(hills).toHaveLength(2)
    expect(lakes).toHaveLength(1)
    expect(hills.map(contour => contour.points.length)).toEqual([4, 4])
    expect(lakes[0]?.points).toHaveLength(4)
    expect(hills.reduce((area, contour) => area + signedArea(contour.points), 0))
      .toBe(80 * 60 * 32 ** 2 - 10 * 10 * 32 ** 2)
    expect(surface.materialAt({ x: 25 * 32, y: 25 * 32 })).toBe('water')
    expect(surface.heightAt({ x: 25 * 32, y: 25 * 32 })).toBe(0)
  })

  it('reuses water corner bevels for decorative hills without changing height or grade', () => {
    const cells = [{ column: 0, row: 0 }, { column: 1, row: 0 }, { column: 0, row: 1 }]
    const hill = compile(paintTerrain(EMPTY_TERRAIN, cells, 'hill'))
    const water = compile(paintTerrain(EMPTY_TERRAIN, cells, 'water'))
    expect(hill.visualContours?.[0]?.points).toEqual(water.contours[0]?.points)
    expect(hill.visualContours?.[0]?.points.length).toBeGreaterThan(hill.contours[0]?.points.length ?? 0)
    expect(hill.heightAt({ x: 2, y: 2 })).toBeGreaterThan(0)
    expect(hill.heightAt({ x: 34, y: 34 })).toBe(0)
    expect(hill.gradeAt({ x: 2, y: 2 }, 'natural')).toBeGreaterThan(0)
    expect(hill.gradeAt({ x: 34, y: 34 }, 'natural')).toBe(0)
  })

  it('preserves visual hill holes, isolated cells and water junctions', () => {
    const hills = paintTerrain(EMPTY_TERRAIN, [
      ...rectangle(0, 2, 0, 2).filter(cell => cell.column !== 1 || cell.row !== 1),
      { column: 6, row: 6 },
    ], 'hill')
    const surface = compile(paintTerrain(hills, [{ column: 1, row: 1 }], 'water'))
    const canonical = surface.contours.filter(contour => contour.kind === 'hill')
    const visual = surface.visualContours?.filter(contour => contour.kind === 'hill') ?? []
    expect(visual).toHaveLength(canonical.length)
    expect(visual.filter(contour => signedArea(contour.points) < 0))
      .toEqual(canonical.filter(contour => signedArea(contour.points) < 0))
    expect(visual.find(contour => contour.points.some(point => point.x === 192 && point.y === 192)))
      .toEqual(canonical.find(contour => contour.points.some(point => point.x === 192 && point.y === 192)))
    expect(surface.materialAt({ x: 48, y: 48 })).toBe('water')
  })

  it('samples natural boundary slopes and a merged hill plateau', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      rectangle(0, 3, 0, 3),
      'hill',
    )
    const surface = compile(terrain)

    expect(surface.heightAt({ x: 1, y: 64 })).toBeCloseTo(1)
    expect(surface.heightAt({ x: 24, y: 64 })).toBe(24)
    expect(surface.heightAt({ x: 64, y: 64 })).toBe(24)
    expect(surface.gradeAt({ x: 12, y: 64 }, 'natural')).toBeCloseTo(1)
    expect(surface.contours.filter(({ kind }) => kind === 'hill')).toHaveLength(
      1,
    )
  })

  it('keeps road-adjacent terrain slopes gentler than natural slopes', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      rectangle(0, 3, 0, 3),
      'hill',
    )
    const position = { x: 16, y: 64 }
    const surface = compile(terrain, [
      { x: 16, y: 0 },
      { x: 16, y: 128 },
    ])

    expect(surface.heightAt(position)).toBeCloseTo(4)
    expect(surface.gradeAt(position, 'natural')).toBeCloseTo(1)
    expect(surface.gradeAt(position, 'road')).toBeLessThan(0.27)
  })

  it('blends continuously from road-adjacent to natural hill grade', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      rectangle(0, 30, -30, 30),
      'hill',
    )
    const surface = compile(terrain, [
      { x: -1_000, y: 0 },
      { x: 1_000, y: 0 },
    ])
    const boundaryDepth = WORLD_ELEVATION.naturalSlopeRun
    const height = (roadDistance: number): number =>
      surface.heightAt({ x: boundaryDepth, y: roadDistance })
    const blendStart = ROAD_GEOMETRY.edgeWidth
    const blendEnd = blendStart + WORLD_ELEVATION.cellSize
    const epsilon = 0.001

    expect(height(blendStart)).toBeCloseTo(
      WORLD_ELEVATION.levelHeight *
        (boundaryDepth / WORLD_ELEVATION.roadSlopeRun),
      6,
    )
    expect(height(blendEnd)).toBe(WORLD_ELEVATION.levelHeight)
    expect(height((blendStart + blendEnd) / 2)).toBeCloseTo(15, 6)
    expect(
      Math.abs(height(blendStart + epsilon) - height(blendStart - epsilon)),
    ).toBeLessThan(0.001)
    expect(
      Math.abs(height(blendEnd + epsilon) - height(blendEnd - epsilon)),
    ).toBeLessThan(0.001)

    const startGrade =
      (height(blendStart + epsilon) - height(blendStart)) / epsilon
    const endGrade =
      (height(blendEnd) - height(blendEnd - epsilon)) / epsilon
    expect(Math.abs(startGrade)).toBeLessThan(0.001)
    expect(Math.abs(endGrade)).toBeLessThan(0.001)
  })

  it('samples authoritative height and gradient without finite-difference lookups', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      rectangle(0, 30, -30, 30),
      'hill',
    )
    const surface = compile(terrain, [
      { x: -1_000, y: 0 },
      { x: 1_000, y: 0 },
    ])
    const position = {
      x: WORLD_ELEVATION.naturalSlopeRun * (2 / 3),
      y: ROAD_GEOMETRY.edgeWidth + WORLD_ELEVATION.cellSize / 2,
    }
    const epsilon = 0.001
    const sample = surface.heightSampleAt(position)

    expect(sample.height).toBeCloseTo(surface.heightAt(position), 6)
    expect(sample.gradient.x).toBeCloseTo(
      (surface.heightAt({ ...position, x: position.x + epsilon }) -
        surface.heightAt({ ...position, x: position.x - epsilon })) /
        (epsilon * 2),
      3,
    )
    expect(sample.gradient.y).toBeCloseTo(
      (surface.heightAt({ ...position, y: position.y + epsilon }) -
        surface.heightAt({ ...position, y: position.y - epsilon })) /
        (epsilon * 2),
      3,
    )
  })

  it('keeps road blending continuous around short-path endpoints and lookup buckets', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      rectangle(-20, 20, 0, 10),
      'hill',
    )
    const pathEnd = ROAD_GEOMETRY.edgeWidth - 1
    const surface = compile(terrain, [
      { x: 0, y: 0 },
      { x: pathEnd, y: 0 },
    ])
    const boundaryDepth = 16
    const blendMidpoint =
      ROAD_GEOMETRY.edgeWidth + WORLD_ELEVATION.cellSize / 2
    const midpointX =
      pathEnd +
      Math.sqrt(blendMidpoint ** 2 - boundaryDepth ** 2)
    const lookupBoundary = ROAD_GEOMETRY.edgeWidth * 2
    const epsilon = 0.001

    expect(
      surface.heightAt({ x: midpointX, y: boundaryDepth }),
    ).toBeCloseTo(10, 5)
    expect(
      Math.abs(
        surface.heightAt({
          x: lookupBoundary + epsilon,
          y: boundaryDepth,
        }) -
          surface.heightAt({
            x: lookupBoundary - epsilon,
            y: boundaryDepth,
          }),
      ),
    ).toBeLessThan(0.001)
  })

  it('keeps water material independent from height', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      [{ column: 0, row: 0 }],
      'water',
    )
    const surface = compile(terrain)

    expect(surface.materialAt({ x: 16, y: 16 })).toBe('water')
    expect(surface.heightAt({ x: 16, y: 16 })).toBe(0)
    expect(surface.materialAt({ x: 48, y: 16 })).toBe('grass')
    expect(surface.contours).toEqual([
      expect.objectContaining({ kind: 'water' }),
    ])
  })

  it('returns flat ground beside a hill without searching the road path', () => {
    const terrain = paintTerrain(EMPTY_TERRAIN, [{ column: 0, row: 0 }], 'hill')
    let coordinateReads = 0
    const surface = compile(terrain, [
      {
        get x() {
          coordinateReads += 1
          return 34
        },
        y: 16,
      },
      { x: 100, y: 16 },
    ])
    const readsAfterCompile = coordinateReads

    expect(surface.heightSampleAt({ x: 35, y: 16 })).toEqual({
      height: WORLD_ELEVATION.baseHeight, gradient: { x: 0, y: 0 },
    })
    expect(coordinateReads).toBe(readsAfterCompile)
  })

  it('reuses terrain contours across road changes and recalculates nearby heights', () => {
    const terrain = paintTerrain(EMPTY_TERRAIN, rectangle(0, 3, 0, 3), 'hill')
    const point = { x: 16, y: 64 }
    const before = compile(terrain, [{ x: 16, y: 0 }, { x: 16, y: 128 }])
    const after = compile(terrain, [{ x: 400, y: 0 }, { x: 400, y: 128 }])

    expect(before.heightAt(point)).toBeCloseTo(4)
    expect(after.heightAt(point)).toBeCloseTo(16)
    expect(after.contours).toBe(before.contours)
  })

  it('caches by terrain and center-path identity', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      [{ column: 0, row: 0 }],
      'hill',
    )
    const centerPath: readonly Vector2[] = [
      { x: -16, y: 16 },
      { x: 48, y: 16 },
    ]

    expect(compile(terrain, centerPath)).toBe(compile(terrain, centerPath))
    expect(compile(terrain, centerPath)).not.toBe(
      compile(terrain, [...centerPath]),
    )
    expect(compile(terrain, centerPath)).not.toBe(
      compile(paintTerrain(terrain, [{ column: 1, row: 0 }], 'hill'), centerPath),
    )
  })

  it('uses true distance to a concave boundary for natural and road slopes', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      rectangle(0, 2, 0, 2).filter(
        (cell) => !(cell.column === 2 && cell.row === 2),
      ),
      'hill',
    )
    const position = { x: 52, y: 52 }

    expect(compile(terrain).heightAt(position)).toBeCloseTo(
      Math.hypot(12, 12),
      6,
    )
    expect(compile(terrain, [position]).heightAt(position)).toBeCloseTo(
      Math.hypot(12, 12) / 4,
      6,
    )
  })

  it('keeps diagonally touching hill islands as separate contours', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      [
        { column: 0, row: 0 },
        { column: 1, row: 1 },
      ],
      'hill',
    )
    const areas = compile(terrain).contours
      .filter(({ kind }) => kind === 'hill')
      .map(({ points }) => Math.abs(signedArea(points)))
      .sort((left, right) => left - right)

    expect(areas).toEqual([32 ** 2, 32 ** 2])
  })

  it('traces a hill hole separately with the opposite winding', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      rectangle(0, 2, 0, 2).filter(
        (cell) => !(cell.column === 1 && cell.row === 1),
      ),
      'hill',
    )
    const areas = compile(terrain).contours
      .filter(({ kind }) => kind === 'hill')
      .map(({ points }) => signedArea(points))
      .sort((left, right) => Math.abs(left) - Math.abs(right))

    expect(areas).toHaveLength(2)
    expect(areas.map((area) => Math.abs(area))).toEqual([32 ** 2, 32 ** 2 * 9])
    const inner = areas[0]
    const outer = areas[1]
    if (inner === undefined || outer === undefined) {
      throw new Error('Expected inner and outer hill contours')
    }
    expect(Math.sign(inner)).toBe(-Math.sign(outer))
  })
})
