import { describe, expect, it } from 'vitest'
import { ROAD_GEOMETRY } from '@/domain/config'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { buildRoadRibbonQuads } from '@/presentation/environments/roadRibbonQuads'
import { indexBitmapItems, roadBitmapTransform } from '@/presentation/environments/meadowBitmapTiles'
import { buildRoadTextureStrip, ROAD_TEXTURE_VARIANTS, roadTextureRepeat } from '@/presentation/environments/roadTextureVariants'

describe('Meadow bitmap geometry', () => {
  it('indexes an overlapping item in all relevant world tiles in paint order', () => {
    const items = [
      [{ x: -4, y: -6 }, { x: 6, y: 8 }],
      [{ x: 3, y: 3 }, { x: 9, y: 9 }],
    ]
    const index = indexBitmapItems(items, item => item)
    expect([...index.keys()].sort()).toEqual(['-1:-1', '-1:0', '0:-1', '0:0'])
    expect(index.get('0:0')).toEqual(items)
  })

  it('uses the same longitudinal texture phase at adjoining straight road samples', () => {
    const geometry = buildTrackGeometry({
      routeKind: 'point-to-point',
      points: [{ x: 0, y: 0, surface: 'street' }, { x: 240, y: 0, surface: 'street' }],
      terrain: EMPTY_TERRAIN,
    })
    const quads = buildRoadRibbonQuads(geometry.path, geometry.ribbon)
    const first = quads[0], next = quads[1]
    if (!first || !next) throw new Error('Expected two road quads')
    const a = roadBitmapTransform(first, 96, 96)
    const b = roadBitmapTransform(next, 96, 96)
    expect(a?.c).toBeCloseTo(1)
    expect(a?.b).toBeCloseTo(ROAD_GEOMETRY.surfaceWidth / 96)
    expect(a?.e).toBeCloseTo(b?.e ?? NaN)
    expect(a?.f).toBeCloseTo(b?.f ?? NaN)
  })
})

describe('road bitmap variations', () => {
  it('bakes three distinct deterministic swatches with blended boundaries, including wraparound', () => {
    const size = 24
    const input = new Uint8ClampedArray(size * size * 4)
    // Horizontally asymmetric but longitudinally constant source isolates the
    // variation boundary from ordinary source texture detail.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        input.set([x * 9, x * 5, 60, 255], (y * size + x) * 4)
      }
    }
    const strip = buildRoadTextureStrip(input, size)
    expect(strip).toHaveLength(input.length * ROAD_TEXTURE_VARIANTS)
    expect(strip).toEqual(buildRoadTextureStrip(input, size))
    const row = (y: number) => strip.slice(y * size * 4, (y + 1) * size * 4)
    expect(row(size / 2)).not.toEqual(row(size + size / 2))
    expect(row(size + size / 2)).not.toEqual(row(size * 2 + size / 2))
    expect(row(size / 2)).not.toEqual(row(size * 2 + size / 2))
    for (let i = 1; i <= ROAD_TEXTURE_VARIANTS; i++) {
      expect(row(i * size - 1)).toEqual(row((i * size) % (size * ROAD_TEXTURE_VARIANTS)))
    }
    expect(() => buildRoadTextureStrip(input, size + 1)).toThrow('Invalid road material swatch')
  })

  it('advances texture phase across all three cells instead of restarting every 96 units', () => {
    const geometry = buildTrackGeometry({
      routeKind: 'point-to-point',
      points: [{ x: 0, y: 0, surface: 'street' }, { x: 400, y: 0, surface: 'street' }],
      terrain: EMPTY_TERRAIN,
    })
    const first = buildRoadRibbonQuads(geometry.path, geometry.ribbon)[0]
    if (!first) throw new Error('Expected a road quad')
    const at = (distance: number) => roadBitmapTransform({
      ...first, from: { ...first.from, distance },
    }, 96, 96, ROAD_TEXTURE_VARIANTS)
    const origin = at(0)
    expect(at(96)?.e).toBeCloseTo((origin?.e ?? NaN) - 96)
    expect(at(192)?.e).toBeCloseTo((origin?.e ?? NaN) - 192)
    expect(at(288)?.e).toBeCloseTo(origin?.e ?? NaN)
    expect(at(192)?.c).toBeCloseTo(origin?.c ?? NaN)
    expect(roadTextureRepeat(720, false)).toBe(96)
    const closed = roadTextureRepeat(720, true) * ROAD_TEXTURE_VARIANTS
    expect(720 / closed).toBeCloseTo(Math.round(720 / closed))
  })
})
