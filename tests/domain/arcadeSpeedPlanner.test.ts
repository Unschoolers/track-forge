import { describe, expect, it } from 'vitest'
import { planArcadeSpeed } from '@/domain/race/arcadeSpeedPlanner'
import type { SurfaceId } from '@/domain/model'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { compileTerrainSurface } from '@/domain/terrain/terrainSurface'
import type { RoadPath, RoadPathPoint } from '@/domain/track/pathBuilder'
import { buildRoadSurfaceProfile } from '@/domain/track/roadSurface'

function route(coordinates: readonly (readonly [number, number])[], surface: SurfaceId = 'street'): RoadPath {
  let distance = 0
  const points: RoadPathPoint[] = coordinates.map(([x, y], index) => {
    const previous = coordinates[index - 1]
    if (previous) distance += Math.hypot(x - previous[0], y - previous[1])
    return { x, y, distance, surface, segment: index, sectionId: 'test', structure: 'surface' }
  })
  const path = { points, totalLength: distance, closed: false }
  const terrainSurface = compileTerrainSurface(EMPTY_TERRAIN, points)
  return {
    ...path,
    crossings: [],
    terrainSurface,
    roadSurface: buildRoadSurfaceProfile(path, terrainSurface),
  }
}

const corner = route([
  [0, 0], [20, 0], [40, 0], [60, 0], [80, 0], [100, 0],
  [115, 5], [125, 15], [130, 30], [130, 50], [130, 70], [130, 90], [130, 110],
])

describe('arcade route speed planning', () => {
  it('does not cap a straight route, regardless of grade', () => {
    expect(planArcadeSpeed(route([[0, 0], [100, 0], [200, 0]]), 0, false)).toBe(Infinity)
  })

  it('anticipates an upcoming bend and releases after passing it', () => {
    const approach = planArcadeSpeed(corner, 1, false)
    expect(approach).toBeLessThan(220)
    expect(approach).toBeGreaterThan(planArcadeSpeed(corner, 6, false))
    expect(planArcadeSpeed(corner, 11, false)).toBe(Infinity)
  })

  it('follows reversed travel and does not plan for a bend behind', () => {
    expect(planArcadeSpeed(corner, 11, true)).toBeLessThan(220)
    expect(planArcadeSpeed(corner, 1, true)).toBe(Infinity)
  })

  it('accounts for uphill and downhill braking without capping straight grades', () => {
    const withGrade = (path: RoadPath, grade: number) => ({
      ...path,
      roadSurface: { ...path.roadSurface, gradeAt: () => grade },
    })
    const straight = route([[0, 0], [100, 0], [200, 0]])
    for (const grade of [-0.1, 0.1]) {
      expect(planArcadeSpeed(withGrade(straight, grade), 0, false)).toBe(Infinity)
    }
    expect(planArcadeSpeed(withGrade(corner, -0.1), 1, false)).toBeLessThan(
      planArcadeSpeed(withGrade(corner, 0.1), 1, false),
    )
    expect(planArcadeSpeed(withGrade(corner, 0.1), 11, true)).toBeLessThan(
      planArcadeSpeed(withGrade(corner, -0.1), 11, true),
    )
  })

  it('does not brake for a nearby crossing arm reached only much later', () => {
    const crossing = route([[0, 0], [100, 0], [200, 0], [300, 0], [400, 0], [500, 0], [500, 100], [250, 100], [100, -100], [100, -120]])
    expect(planArcadeSpeed(crossing, 1, false)).toBeGreaterThan(100)
    expect(planArcadeSpeed(crossing, 6, false)).toBeLessThan(Infinity)
  })

  it('looks through a hairpin along route order in either direction', () => {
    const hairpin = route([[0, 0], [50, 0], [100, 0], [130, 0], [145, 10], [145, 25], [130, 35], [100, 35], [50, 35], [0, 35]])
    expect(planArcadeSpeed(hairpin, 1, false)).toBeLessThan(200)
    expect(planArcadeSpeed(hairpin, 8, true)).toBeLessThan(200)
    expect(planArcadeSpeed(hairpin, 8, false)).toBe(Infinity)
  })

  it('previews across the start of a closed route in both directions', () => {
    const square = route([[0, 0], [100, 0], [100, 100], [0, 100]])
    const loop = { ...square, closed: true, totalLength: 400 }
    expect(planArcadeSpeed(loop, 3, false)).toBeLessThan(200)
    expect(planArcadeSpeed(loop, 0, true)).toBeLessThan(200)
  })

  it('anticipates a sharp corner more than 360 world units away at high speed', () => {
    const longApproach = route([[0, 0], [200, 0], [400, 0], [600, 0], [620, 0], [635, 5], [645, 15], [650, 30], [650, 50]])
    const target = planArcadeSpeed(longApproach, 0, false)
    expect(target).toBeLessThan(300)
    expect(target).toBeGreaterThan(100)
  })

  it('does not mistake alternating resampling noise for a tight corner', () => {
    const noisy = route(Array.from({ length: 100 }, (_, i) => [i * 6, i % 2 ? 0.2 : -0.2] as const))
    expect(planArcadeSpeed(noisy, 50, false)).toBeGreaterThan(220)
  })

  it('uses the selected car grip when planning a bend', () => {
    expect(planArcadeSpeed(corner, 5, false, 'red')).toBeLessThan(planArcadeSpeed(corner, 5, false, 'green'))
  })

  it('anticipates a change from street to ice at the corner', () => {
    const ice = {
      ...corner,
      points: corner.points.map((point, index) =>
        index < 5 ? point : { ...point, surface: 'ice' as const },
      ),
    }
    expect(planArcadeSpeed(ice, 2, false)).toBeLessThan(planArcadeSpeed(corner, 2, false))
  })
})
