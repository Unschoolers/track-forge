import { describe, expect, it } from 'vitest'
import { ROAD_GEOMETRY } from '@/domain/config'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { buildRoadRibbonQuads } from '@/presentation/environments/roadRibbonQuads'
import { toyBrickSpacing, toyRoadBricks } from '@/presentation/environments/toyRoadBricks'

describe('toy brick road shoulders', () => {
  it('fits whole color sequences on closed routes', () => {
    expect(toyBrickSpacing(710, false)).toBe(18)
    const count = 710 / toyBrickSpacing(710, true)
    expect(count % 3).toBeCloseTo(0)
  })

  it('keeps bricks on both shoulders and studs unique across sample boundaries', () => {
    const geometry = buildTrackGeometry({
      routeKind: 'point-to-point',
      points: [{ x: 0, y: 0, surface: 'street' }, { x: 180, y: 0, surface: 'dirt' }],
      terrain: EMPTY_TERRAIN,
    })
    const quads = buildRoadRibbonQuads(geometry.path, geometry.ribbon)
    const day = quads.flatMap(quad => toyRoadBricks(quad, 18, false))
    const night = quads.flatMap(quad => toyRoadBricks(quad, 18, true))
    expect(day.length).toBeGreaterThan(0)
    expect(new Set(day.map(piece => piece.color)).size).toBe(3)
    expect(day.map(piece => piece.polygon)).toEqual(night.map(piece => piece.polygon))
    expect(day.map(piece => piece.color)).not.toEqual(night.map(piece => piece.color))
    for (const { polygon } of day) for (const point of polygon) {
      expect(Math.abs(point.y)).toBeGreaterThan(ROAD_GEOMETRY.surfaceWidth / 2)
      expect(Math.abs(point.y)).toBeLessThan(ROAD_GEOMETRY.edgeWidth / 2)
    }
    const studs = day.flatMap(piece => piece.stud ? [piece.stud] : [])
    expect(studs).toHaveLength(20)
    expect(new Set(studs.map(point => `${point.x.toFixed(4)}:${point.y.toFixed(4)}`)).size).toBe(studs.length)
  })
})
