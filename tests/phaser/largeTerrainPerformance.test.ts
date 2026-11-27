import { describe, expect, it, vi } from 'vitest'
import { compileTerrainSurface } from '@/domain/terrain/terrainSurface'
import { WORLD_ELEVATION } from '@/domain/config'
import { buildTerrainComponents, tileTerrainComponent } from '@/phaser/rendering/terrainTopology'
import {
  compileTerrainPresentation,
  RegionalTerrainMeshCache,
} from '@/phaser/rendering/terrainMesh'
import { terrainDetailForView } from '@/phaser/rendering/terrainDetail'
import { renderRoadRibbon } from '@/phaser/rendering/roadRibbonRenderer'

function landscape(width: number, height: number) {
  return {
    cellSize: 32,
    cells: Array.from({ length: width * height }, (_, index) => ({
      column: (index % width) - 20,
      row: Math.floor(index / width) - 90,
      kind: 'hill' as const,
    })),
  }
}

describe('large track rendering budgets', () => {
  it.each(['full', 'overview'] as const)('reuses unaffected hill samples and static tessellation after a nearby road edit (%s)', (detail) => {
    const terrain = landscape(45, 60)
    const west = -20 * 32
    const north = -90 * 32
    const beforePath = [{ x: west + 8, y: north + 8 }, { x: west + 100, y: north + 8 }]
    const afterPath = [{ x: west + 8, y: north + 24 }, { x: west + 100, y: north + 24 }]
    const cache = new RegionalTerrainMeshCache()
    const first = compileTerrainSurface(terrain, beforePath)
    const next = compileTerrainSurface(terrain, afterPath)
    const firstSamples = vi.fn(first.heightSampleAt)
    const nextSamples = vi.fn(next.heightSampleAt)
    const before = compileTerrainPresentation({ ...first, heightSampleAt: firstSamples }, detail, cache)
    const edited = compileTerrainPresentation({ ...next, heightSampleAt: nextSamples }, detail, cache)
    const uncached = compileTerrainPresentation({ ...next }, detail)
    expect(edited).toEqual(uncached)
    expect(edited).not.toEqual(before)
    expect(nextSamples.mock.calls.length).toBeGreaterThan(0)
    expect(nextSamples.mock.calls.length).toBeLessThan(firstSamples.mock.calls.length / 4)
    const shadows = (mesh: typeof edited) => mesh.primitives
      .filter(primitive => primitive.kind === 'hill-shadow')
      .flatMap(primitive => primitive.triangles)
    expect(shadows(edited)[0]).toBe(shadows(before)[0])

    const undoSamples = vi.fn(first.heightSampleAt)
    const undone = compileTerrainPresentation({ ...first, heightSampleAt: undoSamples }, detail, cache)
    expect(undone).toEqual(before)
    expect(undoSamples.mock.calls.length).toBeLessThan(firstSamples.mock.calls.length / 4)

    // Authoring terrain is a different dependency: even identical road
    // segments must not reuse the prior terrain's boundary height samples.
    const modified = compileTerrainSurface({ ...terrain, cells: terrain.cells.slice(1) }, afterPath)
    const modifiedSamples = vi.fn(modified.heightSampleAt)
    const rebuilt = compileTerrainPresentation({ ...modified, heightSampleAt: modifiedSamples }, detail, cache)
    expect(rebuilt).toEqual(compileTerrainPresentation({ ...modified }, detail))
    expect(modifiedSamples.mock.calls.length).toBeGreaterThan(firstSamples.mock.calls.length * 0.95)
    cache.clear()
  })

  it('prefers overview for Papou-scale terrain even during a race', () => {
    expect(terrainDetailForView(2_741, 1)).toBe('overview')
    expect(terrainDetailForView(0, 0.1)).toBe('overview')
    expect(terrainDetailForView(50, 1)).toBe('full')
  })

  it('preserves world-space hill coverage with about four times fewer polygons', () => {
    // A contiguous landmass of 2,700 cells approximates the authored-cell
    // volume of the large user track, without including private track data.
    const terrain = landscape(45, 60)
    const surface = compileTerrainSurface(terrain, [])
    const regular = compileTerrainPresentation(surface)
    const overview = compileTerrainPresentation(surface, 'overview')
    expect(overview.stats.triangleCount).toBeLessThan(regular.stats.triangleCount / 3)
    expect(overview.stats.facetCount).toBeLessThan(regular.stats.facetCount)
    expect(overview.stats.contourPointCount).toBe(regular.stats.contourPointCount)
    expect(compileTerrainPresentation(surface, 'overview')).toBe(overview)
    expect(compileTerrainPresentation(surface, 'full')).toBe(regular)
  })

  it('fuses flat overview hill spans without altering their exact coverage', () => {
    const surface = compileTerrainSurface(landscape(80, 80), [])
    const full = compileTerrainPresentation(surface, 'full')
    const overview = compileTerrainPresentation(surface, 'overview')
    const plateauArea = (presentation: typeof full) =>
      presentation.primitives
        .filter((primitive) => primitive.kind === 'hill-plateau')
        .flatMap((primitive) => primitive.triangles)
        .reduce((sum, [a, b, c]) => sum +
          Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2, 0)

    // Full detail intentionally samples half-cells. Compare overview against
    // its own original per-cell plateau classification, before run merging.
    const hill = buildTerrainComponents(surface.contours, 'hill')[0]
    if (!hill) throw new Error('Missing hill component')
    const quads = tileTerrainComponent(hill, WORLD_ELEVATION.cellSize)
    let unmergedPlateauArea = 0
    for (let index = 0; index < quads.length; index += 2) {
      const first = quads[index]
      const second = quads[index + 1]
      if (!first || !second) continue
      const center = {
        x: (first[0].x + first[2].x) / 2,
        y: (first[0].y + first[2].y) / 2,
      }
      if (surface.heightSampleAt(center).height >= WORLD_ELEVATION.levelHeight - 0.001) {
        unmergedPlateauArea += WORLD_ELEVATION.cellSize ** 2
      }
    }
    expect(plateauArea(overview)).toBe(unmergedPlateauArea)
    expect(overview.stats.triangleCount).toBeLessThan(full.stats.triangleCount / 4)
    expect(overview.stats.contourPointCount).toBe(4)
  })

  it('samples hill elevation once per overview tile instead of four times', () => {
    const terrain = landscape(16, 16)
    const base = compileTerrainSurface(terrain, [])
    const fullSample = vi.fn(base.heightSampleAt)
    const overviewSample = vi.fn(base.heightSampleAt)
    compileTerrainPresentation({ ...base, heightSampleAt: fullSample }, 'full')
    compileTerrainPresentation({ ...base, heightSampleAt: overviewSample }, 'overview')
    expect(fullSample).toHaveBeenCalledTimes(16 * 16 * 4)
    expect(overviewSample).toHaveBeenCalledTimes(16 * 16)
  })

  it('renders a long road ribbon without any expensive path triangulation', () => {
    const count = 1_500
    const samples = Array.from({ length: count }, (_, index) => ({
      x: index * 6, y: 100 * Math.sin(index / 60), surface: 'street' as const,
      distance: index * 6, segment: 0, sectionId: 'road', structure: 'surface' as const,
    }))
    const ribbon = samples.map(center => ({
      center, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 },
      left: { x: center.x, y: center.y + 36 },
      right: { x: center.x, y: center.y - 36 },
      edgeLeft: { x: center.x, y: center.y + 43 },
      edgeRight: { x: center.x, y: center.y - 43 },
      surface: center.surface,
    }))
    const graphics = {
      fillTriangle: vi.fn(), fillStyle: vi.fn(),
      lineStyle: vi.fn(), lineBetween: vi.fn(),
      beginPath: vi.fn(), fillPath: vi.fn(),
    }
    renderRoadRibbon(graphics as never, {
      points: samples, closed: false,
    } as never, ribbon, false)
    expect(graphics.fillTriangle).toHaveBeenCalledTimes((count - 1) * 4)
    expect(graphics.fillStyle).toHaveBeenCalledTimes(2)
    // Sparse material detail uses bounded line calls, never polygon tessellation.
    expect(graphics.lineBetween).toHaveBeenCalled()
    expect(graphics.lineBetween.mock.calls.length).toBeLessThan(count * 2)
    expect(graphics.beginPath).not.toHaveBeenCalled()
    expect(graphics.fillPath).not.toHaveBeenCalled()
  })
})
