import { describe, expect, it } from 'vitest'
import { splitBankSegment, WATER_BANK_RADIUS, WATER_SHALLOW_RADIUS, indexBitmapItems, terrainBitmapIndex } from '@/presentation/environments/meadowBitmapTiles'
import { GROUND_TILE_SIZE } from '@/presentation/environments/groundTexture'
import { EMPTY_TERRAIN, paintTerrain } from '@/domain/terrain/terrainField'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'

describe('Meadow shoreline materials', () => {
  it('preserves long authored shore boundaries without oversized bitmap primitives', () => {
    const start = { x: -9000, y: 120 }
    const end = { x: 9000, y: 120 }
    const segments = splitBankSegment(start, end)
    expect(segments[0]?.start).toEqual(start)
    expect(segments.at(-1)?.end).toEqual(end)
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      if (!segment) throw new Error('Missing bank segment')
      expect(Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y)).toBeLessThanOrEqual(GROUND_TILE_SIZE + 1e-8)
      if (i > 0) expect(segment.start).toEqual(segments[i - 1]?.end)
    }
    const indexed = indexBitmapItems(segments, segment => [segment.start, segment.end], WATER_SHALLOW_RADIUS + 2)
    expect(indexed.size).toBeGreaterThan(64)
  })

  it('indexes a rounded continuous hill mask and keeps water-only tiles independent', () => {
    const terrain = paintTerrain(EMPTY_TERRAIN, [
      { column: 0, row: 0 }, { column: 1, row: 0 }, { column: 0, row: 1 },
    ], 'hill')
    const geometry = buildTrackGeometry({
      routeKind: 'point-to-point',
      points: [{ x: 0, y: 320, surface: 'street' }, { x: 240, y: 320, surface: 'street' }],
      terrain,
    })
    const items = terrainBitmapIndex(geometry, false, 'hill').get('0:0') ?? []
    const mask = items.filter(item => item.kind === 'hill-mask')
    expect(mask.length).toBeGreaterThan(0)
    expect(mask.some(item => item.triangle.some(point => point.x % 32 !== 0 && point.y % 32 === 0))).toBe(true)
    expect(items.some(item => item.kind === 'hill-bank' &&
      item.segment.start.x !== item.segment.end.x &&
      item.segment.start.y !== item.segment.end.y)).toBe(true)
    expect(items.some(item => item.kind === 'slope')).toBe(true)
    expect(terrainBitmapIndex(geometry, false, 'water').size).toBe(0)
  })

  it('includes the shallow shelf and sand when a shoreline is just outside a tile', () => {
    expect(WATER_SHALLOW_RADIUS).toBeGreaterThan(WATER_BANK_RADIUS)
    const segments = splitBankSegment({ x: 270, y: 40 }, { x: 270, y: 100 })
    const index = indexBitmapItems(segments, segment => [segment.start, segment.end], WATER_SHALLOW_RADIUS + 2)
    expect(index.get('0:0')).toEqual(segments)
    expect(index.get('1:0')).toEqual(segments)
  })
})
