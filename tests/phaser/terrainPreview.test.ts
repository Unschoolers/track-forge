import { describe, expect, it, vi } from 'vitest'
import { TERRAIN_LIMITS } from '@/domain/config'
import type { TerrainPreview } from '@/phaser/input/editorInput'
import {
  buildTerrainPreviewRegions,
  buildTerrainPreviewRoadSegments,
  TERRAIN_PREVIEW_LIMITS,
} from '@/phaser/rendering/terrainPreview'
import { normalizeTerrain } from '@/domain/terrain/terrainField'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { renderTerrainImpactPreview } from '@/phaser/rendering/terrainRenderer'

function preview(
  cells: TerrainPreview['cells'],
  dirtyCells: TerrainPreview['dirtyCells'] = cells,
): TerrainPreview {
  const terrain = normalizeTerrain({
    cells: cells.map((cell) => ({ ...cell, kind: 'hill' })),
  })
  return {
    revision: 1,
    position: { x: 16, y: 16 },
    radius: 48,
    kind: 'hill',
    cells,
    dirtyCells,
    terrain,
  }
}

describe('terrain editor impact preview', () => {
  it('bounds candidate compilation to a fixed number of padded spatial chunks', () => {
    const cells = Array.from({ length: TERRAIN_LIMITS.maximumCells }, (_, index) => ({
      column: (index % 200) * 2,
      row: Math.floor(index / 200) * 2,
    }))
    const dirtyCells = cells.filter((_, index) => index % 97 === 0)

    const regions = buildTerrainPreviewRegions(preview(cells, dirtyCells))

    expect(regions.length).toBeGreaterThan(0)
    expect(regions).toHaveLength(TERRAIN_PREVIEW_LIMITS.maximumRegions)
    expect(
      regions.every(
        ({ terrain }) =>
          terrain.cells.length <= TERRAIN_PREVIEW_LIMITS.maximumCellsPerRegion,
      ),
    ).toBe(true)
    expect(
      regions.reduce((total, region) => total + region.terrain.cells.length, 0),
    ).toBeLessThan(cells.length)
  })

  it('derives changed road-grade segments from canonical candidate geometry', () => {
    const service = new TrackGeometryService()
    const points = [
      { x: -180, y: 16, surface: 'street' as const },
      { x: 180, y: 16, surface: 'street' as const },
      { x: 360, y: 180, surface: 'street' as const },
    ]
    const candidate = preview(
      Array.from({ length: 8 }, (_, column) => ({ column, row: 0 })),
    )
    const region = buildTerrainPreviewRegions(candidate)[0]
    if (!region) throw new Error('Expected a terrain preview region')
    const committed = service.get({
      points,
      terrain: normalizeTerrain({ cells: [] }),
    }).path
    const changed = service.get({
      points,
      terrain: region.terrain,
    }).path

    const segments = buildTerrainPreviewRoadSegments(
      committed,
      changed,
      region.bounds,
    )

    expect(segments.length).toBeGreaterThan(0)
    expect(
      segments.every(
        ({ gradeDelta, heightDelta }) =>
          Math.abs(gradeDelta) > 0.000_1 ||
          Math.abs(heightDelta) > 0.000_1,
      ),
    ).toBe(true)
  })

  it('keeps truncated context boundaries outside the dirty impact window', () => {
    const service = new TrackGeometryService()
    const points = [
      { x: -800, y: 16, surface: 'street' as const },
      { x: 800, y: 16, surface: 'street' as const },
    ]
    const terrain = normalizeTerrain({
      cells: Array.from({ length: 41 * 9 }, (_, index) => ({
        column: (index % 41) - 20,
        row: Math.floor(index / 41) - 4,
        kind: 'hill',
      })),
    })
    const candidate: TerrainPreview = {
      ...preview([{ column: 0, row: 0 }]),
      terrain,
    }
    const region = buildTerrainPreviewRegions(candidate)[0]
    if (!region) throw new Error('Expected a terrain preview region')
    const full = service.get({ points, terrain }).path
    const windowed = service.get({ points, terrain: region.terrain }).path

    expect(
      buildTerrainPreviewRoadSegments(full, windowed, region.bounds),
    ).toEqual([])
  })

  it('renders candidate contours, slopes, and changed road grades', () => {
    const service = new TrackGeometryService()
    const points = [
      { x: -180, y: 16, surface: 'street' as const },
      { x: 180, y: 16, surface: 'street' as const },
      { x: 360, y: 180, surface: 'street' as const },
    ]
    const candidate = preview(
      Array.from({ length: 8 }, (_, column) => ({ column, row: 0 })),
    )
    const region = buildTerrainPreviewRegions(candidate)[0]
    if (!region) throw new Error('Expected a terrain preview region')
    const committed = service.get({
      points,
      terrain: normalizeTerrain({ cells: [] }),
    }).path
    const changed = service.get({ points, terrain: region.terrain }).path
    const road = buildTerrainPreviewRoadSegments(
      committed,
      changed,
      region.bounds,
    )
    const graphics = {
      fillStyle: vi.fn(),
      lineStyle: vi.fn(),
      fillTriangle: vi.fn(),
      lineBetween: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      strokePath: vi.fn(),
    }

    renderTerrainImpactPreview(
      graphics as never,
      changed.terrainSurface,
      road,
      false,
      region.bounds,
    )

    expect(graphics.fillTriangle).toHaveBeenCalled()
    expect(graphics.lineBetween.mock.calls.length).toBeGreaterThan(road.length)
    expect(
      graphics.fillTriangle.mock.calls.every(
        ([x1, y1, x2, y2, x3, y3]) =>
          Math.max(x1, x2, x3) >= region.bounds.left &&
          Math.min(x1, x2, x3) <= region.bounds.right &&
          Math.max(y1, y2, y3) >= region.bounds.top &&
          Math.min(y1, y2, y3) <= region.bounds.bottom,
      ),
    ).toBe(true)
  })
})
