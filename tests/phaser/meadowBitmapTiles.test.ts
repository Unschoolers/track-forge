import { describe, expect, it } from 'vitest'
import { ROAD_GEOMETRY } from '@/domain/config'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { buildRoadRibbonQuads } from '@/presentation/environments/roadRibbonQuads'
import { indexBitmapItems, roadBitmapTransform } from '@/presentation/environments/meadowBitmapTiles'

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
