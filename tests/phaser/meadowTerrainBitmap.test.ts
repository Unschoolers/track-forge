import { describe, expect, it } from 'vitest'
import { splitBankSegment, WATER_BANK_RADIUS, WATER_SHALLOW_RADIUS, indexBitmapItems } from '@/presentation/environments/meadowBitmapTiles'
import { GROUND_TILE_SIZE } from '@/presentation/environments/groundTexture'

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

  it('includes the shallow shelf and sand when a shoreline is just outside a tile', () => {
    expect(WATER_SHALLOW_RADIUS).toBeGreaterThan(WATER_BANK_RADIUS)
    const segments = splitBankSegment({ x: 270, y: 40 }, { x: 270, y: 100 })
    const index = indexBitmapItems(segments, segment => [segment.start, segment.end], WATER_SHALLOW_RADIUS + 2)
    expect(index.get('0:0')).toEqual(segments)
    expect(index.get('1:0')).toEqual(segments)
  })
})
