import { describe, expect, it, vi } from 'vitest'
import { compileTerrainSurface } from '@/domain/terrain/terrainSurface'
import {
  compileTerrainPresentation,
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
      beginPath: vi.fn(), fillPath: vi.fn(),
    }
    renderRoadRibbon(graphics as never, {
      points: samples, closed: false,
    } as never, ribbon, false)
    expect(graphics.fillTriangle).toHaveBeenCalledTimes((count - 1) * 4)
    expect(graphics.fillStyle).toHaveBeenCalledTimes(2)
    expect(graphics.beginPath).not.toHaveBeenCalled()
    expect(graphics.fillPath).not.toHaveBeenCalled()
  })
})
