import { describe, expect, it, vi } from 'vitest'
import { buildTerrainComponents, pointInTerrainComponent, tileTerrainComponent, triangulateTerrainComponent } from '@/phaser/rendering/terrainTopology'
import type { TerrainCell, Vector2 } from '@/domain/model'
import {
  EMPTY_TERRAIN,
  paintTerrain,
} from '@/domain/terrain/terrainField'
import { compileTerrainSurface } from '@/domain/terrain/terrainSurface'
import {
  buildTerrainPresentation,
  compileTerrainPresentation,
  TERRAIN_PRESENTATION_LIMITS,
  type TerrainPrimitive,
} from '@/phaser/rendering/terrainRenderer'

type Triangle = readonly [Vector2, Vector2, Vector2]

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

function trianglesFor(
  primitives: readonly TerrainPrimitive[],
  kinds: ReadonlySet<TerrainPrimitive['kind']>,
): readonly Triangle[] {
  return primitives.flatMap((primitive) => {
    if (!kinds.has(primitive.kind) || !('triangles' in primitive)) return []
    return primitive.triangles as readonly Triangle[]
  })
}

function triangleArea(triangle: Triangle): number {
  const [first, second, third] = triangle
  return (
    (first.x * (second.y - third.y) +
      second.x * (third.y - first.y) +
      third.x * (first.y - second.y)) /
    2
  )
}

function triangleContains(point: Vector2, triangle: Triangle): boolean {
  const [first, second, third] = triangle
  const area = Math.abs(triangleArea(triangle))
  const parts =
    Math.abs(triangleArea([point, second, third])) +
    Math.abs(triangleArea([first, point, third])) +
    Math.abs(triangleArea([first, second, point]))
  return Math.abs(parts - area) <= 0.001
}

function covered(point: Vector2, triangles: readonly Triangle[]): boolean {
  return triangles.some((triangle) => triangleContains(point, triangle))
}

function centroid(triangle: Triangle): Vector2 {
  return {
    x: (triangle[0].x + triangle[1].x + triangle[2].x) / 3,
    y: (triangle[0].y + triangle[1].y + triangle[2].y) / 3,
  }
}

function terrainRectangle(
  width: number,
  height: number,
  kind: TerrainCell['kind'] = 'hill',
) {
  const cells: TerrainCell[] = []
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      cells.push({ column, row, kind })
    }
  }
  return { cellSize: 32, cells } as const
}

describe('terrain presentation topology', () => {
  it('matches the rounded water hazard with both vector and bitmap geometry', () => {
    // Three cells form an L with one concave corner and five convex corners.
    const terrain = paintTerrain(EMPTY_TERRAIN, [
      { column: 0, row: 0 }, { column: 1, row: 0 }, { column: 0, row: 1 },
    ], 'water')
    const surface = compileTerrainSurface(terrain, [])
    const component = buildTerrainComponents(surface.contours, 'water')[0]
    if (!component) throw new Error('Missing water component')
    const vector = trianglesFor(buildTerrainPresentation(surface), new Set(['water']))
    const bitmap = tileTerrainComponent(component, 16)

    for (const [point, water] of [
      [{ x: 2, y: 2 }, false],
      [{ x: 16, y: 16 }, true],
      [{ x: 34, y: 34 }, true],
      [{ x: 50, y: 50 }, false],
    ] as const) {
      expect(surface.materialAt(point)).toBe(water ? 'water' : 'grass')
      expect(pointInTerrainComponent(point, component)).toBe(water)
      expect(covered(point, vector)).toBe(water)
      expect(covered(point, bitmap)).toBe(water)
    }
    // The complete diagonal polygon must be covered, not midpoint rectangles.
    const polygonArea = (ring: readonly Vector2[]): number =>
      Math.abs(ring.reduce((sum, a, index) => {
        const b = ring[(index + 1) % ring.length]
        return b ? sum + a.x * b.y - b.x * a.y : sum
      }, 0) / 2)
    for (const triangles of [vector, bitmap]) {
      expect(triangles.reduce((sum, triangle) => sum + Math.abs(triangleArea(triangle)), 0))
        .toBeCloseTo(polygonArea(component.outer), 6)
    }
  })

  it('preserves hill junctions and isolated water hazards', () => {
    const water = paintTerrain(EMPTY_TERRAIN, [
      { column: 0, row: 0 }, { column: 1, row: 0 }, { column: 4, row: 4 },
    ], 'water')
    const terrain = paintTerrain(water, [{ column: -1, row: -1 }], 'hill')
    const surface = compileTerrainSurface(terrain, [])
    expect(surface.materialAt({ x: 2, y: 2 })).toBe('water')
    expect(surface.materialAt({ x: 130, y: 130 })).toBe('water')
    expect(surface.materialAt({ x: -2, y: -2 })).toBe('grass')
    expect(surface.heightAt({ x: -2, y: -2 })).toBeGreaterThan(0)
  })

  it('triangulates diagonal outer and hole edges without filling the hole', () => {
    const component = {
      kind: 'water' as const,
      outer: [{ x: 0, y: 30 }, { x: 30, y: 0 }, { x: 60, y: 30 }, { x: 30, y: 60 }],
      holes: [[{ x: 30, y: 20 }, { x: 20, y: 30 }, { x: 30, y: 40 }, { x: 40, y: 30 }]],
    }
    for (const triangles of [
      triangulateTerrainComponent(component),
      tileTerrainComponent(component, 16),
    ]) {
      expect(covered({ x: 30, y: 30 }, triangles)).toBe(false)
      expect(covered({ x: 30, y: 10 }, triangles)).toBe(true)
      expect(covered({ x: 2, y: 2 }, triangles)).toBe(false)
      expect(triangles.reduce((sum, triangle) => sum + Math.abs(triangleArea(triangle)), 0))
        .toBeCloseTo(1600, 6)
      expect(triangles.every(triangle => Math.abs(triangleArea(triangle)) > 0)).toBe(true)
    }
  })

  it('keeps a donut hill hole empty across slope and plateau meshes', () => {
    const ring = rectangle(0, 8, 0, 8).filter(
      ({ column, row }) =>
        column < 3 || column > 5 || row < 3 || row > 5,
    )
    const surface = compileTerrainSurface(
      paintTerrain(EMPTY_TERRAIN, ring, 'hill'),
      [],
    )
    const triangles = trianglesFor(
      buildTerrainPresentation(surface),
      new Set(['hill-slope', 'hill-plateau']),
    )
    const holeCenter = { x: 144, y: 144 }

    expect(triangles.length).toBeGreaterThan(0)
    expect(surface.heightAt(holeCenter)).toBe(0)
    expect(covered(holeCenter, triangles)).toBe(false)
  })

  it('renders a lake inside a hill without filling its hill hole', () => {
    const hill = paintTerrain(
      EMPTY_TERRAIN,
      rectangle(0, 8, 0, 8),
      'hill',
    )
    const terrain = paintTerrain(
      hill,
      rectangle(3, 5, 3, 5),
      'water',
    )
    const surface = compileTerrainSurface(terrain, [])
    const presentation = buildTerrainPresentation(surface)
    const hillTriangles = trianglesFor(
      presentation,
      new Set(['hill-slope', 'hill-plateau']),
    )
    const waterTriangles = trianglesFor(
      presentation,
      new Set(['water']),
    )
    const lakeCenter = { x: 144, y: 144 }

    expect(waterTriangles.length).toBeGreaterThan(0)
    expect(covered(lakeCenter, waterTriangles)).toBe(true)
    expect(covered(lakeCenter, hillTriangles)).toBe(false)
  })

  it('keeps the exact authored water ripple pattern across concave shorelines and islands', () => {
    const water = paintTerrain(EMPTY_TERRAIN, rectangle(0, 19, 0, 19), 'water')
    const island = paintTerrain(water, rectangle(5, 11, 6, 12), 'ground')
    const terrain = paintTerrain(island, rectangle(17, 19, 17, 19), 'ground')
    const surface = compileTerrainSurface(terrain, [])
    const component = buildTerrainComponents(surface.contours, 'water')[0]
    if (!component) throw new Error('Missing water component')

    const ripples = buildTerrainPresentation(surface)
      .filter((primitive) => primitive.kind === 'water')
      .flatMap((primitive) => primitive.texture)
    const minX = Math.min(...component.outer.map(p => p.x))
    const maxX = Math.max(...component.outer.map(p => p.x))
    const minY = Math.min(...component.outer.map(p => p.y))
    const maxY = Math.max(...component.outer.map(p => p.y))
    const expected: typeof ripples[number][] = []
    for (let y = minY + 11; y < maxY; y += 22) {
      const row = Math.round((y - minY) / 22)
      for (let x = minX + 11 + (row % 2 === 0 ? 0 : 11); x < maxX; x += 22) {
        const start = { x: x - 5, y }
        const end = { x: x + 5, y }
        if (pointInTerrainComponent(start, component) && pointInTerrainComponent(end, component)) {
          expected.push({ start, end })
        }
      }
    }
    expect(ripples).toEqual(expected)
  })

  it('triangulates a concave hill without self-crossing fill geometry', () => {
    const concave = rectangle(0, 7, 0, 7).filter(
      ({ column, row }) => column < 3 || row < 3,
    )
    const surface = compileTerrainSurface(
      paintTerrain(EMPTY_TERRAIN, concave, 'hill'),
      [],
    )
    const triangles = trianglesFor(
      buildTerrainPresentation(surface),
      new Set(['hill-slope', 'hill-plateau']),
    )
    const cutoutCenter = { x: 176, y: 176 }

    expect(triangles.length).toBeGreaterThan(0)
    expect(
      triangles.every((triangle) => Math.abs(triangleArea(triangle)) > 0.001),
    ).toBe(true)
    expect(
      triangles.every(
        (triangle) => surface.heightAt(centroid(triangle)) > 0,
      ),
    ).toBe(true)
    expect(covered(cutoutCenter, triangles)).toBe(false)
  })

  it.each([
    [32, 32],
    [16, 64],
    [64, 16],
  ])(
    'bounds a %ix%i contiguous hill independently of orientation',
    (width, height) => {
      const surface = compileTerrainSurface(
        terrainRectangle(width, height),
        [],
      )
      const presentation = compileTerrainPresentation(surface)

      expect(presentation.stats.triangleCount).toBeLessThanOrEqual(
        width * height * TERRAIN_PRESENTATION_LIMITS.trianglesPerCell,
      )
      expect(presentation.stats.chunkCount).toBeLessThanOrEqual(
        TERRAIN_PRESENTATION_LIMITS.maximumChunks,
      )
      // The exact internal triangulation is not a product contract:
      // straight contour compaction reduces shadow geometry with no loss of area.
      expect(presentation.stats.triangleCount).toBeGreaterThan(width * height * 8)
      expect(presentation.stats.contourPointCount).toBe(4)
    },
  )

  it('uses one authoritative height sample per hill mesh quad', () => {
    const width = 8
    const height = 8
    const surface = compileTerrainSurface(
      terrainRectangle(width, height),
      [],
    )
    const heightSampleAt = vi.fn(surface.heightSampleAt)

    compileTerrainPresentation({ ...surface, heightSampleAt })

    expect(heightSampleAt).toHaveBeenCalledTimes(width * height * 4)
  })

  it('caps chunks for a worst-case isolated mixed terrain map', () => {
    const cells = Array.from({ length: 20_000 }, (_, index) => ({
      column: (index % 200) * 2,
      row: Math.floor(index / 200) * 2,
      kind: index === 0 ? ('water' as const) : ('hill' as const),
    }))
    const presentation = compileTerrainPresentation(
      compileTerrainSurface({ cellSize: 32, cells }, []),
    )

    expect(presentation.stats.triangleCount).toBe(199_992)
    expect(presentation.stats.chunkCount).toBe(52)
    expect(presentation.stats.chunkCount).toBeLessThanOrEqual(
      TERRAIN_PRESENTATION_LIMITS.maximumChunks,
    )
  })

  it(
    'keeps supported 20,000-cell block and checkerboard maps within budgets',
    () => {
      const block = compileTerrainPresentation(
        compileTerrainSurface(terrainRectangle(125, 160), []),
      )
      const checkerboard = terrainRectangle(200, 100)
      const mixed = {
        ...checkerboard,
        cells: checkerboard.cells.map((cell) => ({
          ...cell,
          kind:
            (cell.column + cell.row) % 2 === 0
              ? ('hill' as const)
              : ('water' as const),
        })),
      }
      const checkerSurface = compileTerrainSurface(mixed, [])
      const checker = compileTerrainPresentation(checkerSurface)

      for (const presentation of [block, checker]) {
        expect(presentation.stats.triangleCount).toBeLessThanOrEqual(
          TERRAIN_PRESENTATION_LIMITS.maximumTriangles,
        )
        expect(presentation.stats.chunkCount).toBeLessThanOrEqual(
          TERRAIN_PRESENTATION_LIMITS.maximumChunks,
        )
        expect(presentation.stats.contourPointCount).toBeLessThanOrEqual(
          TERRAIN_PRESENTATION_LIMITS.maximumContourPoints,
        )
        expect(presentation.stats.textureLineCount).toBeLessThanOrEqual(
          TERRAIN_PRESENTATION_LIMITS.maximumTextureLines,
        )
      }
      expect(block.stats.triangleCount).toBeLessThan(160_320)
      expect(block.stats.contourPointCount).toBe(4)
      expect(block.stats.textureLineCount).toBe(0)
      expect(checker.stats).toMatchObject({
        triangleCount: 120_000,
        chunkCount: 40,
        contourPointCount: 80_000,
        textureLineCount: 10_000,
      })
      expect(compileTerrainPresentation(checkerSurface)).toBe(checker)
    },
    30_000,
  )
})
