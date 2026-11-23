import { describe, expect, it } from 'vitest'
import { ROAD_GEOMETRY } from '@/domain/config'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { turnAmountAt } from '@/domain/race/trackContext'
import { plannedApexCut } from '@/domain/race/ai/apexCut'

const path = buildRoadPath([
  { x: 0, y: 0, surface: 'street', curve: 'corner' },
  { x: 850, y: 0, surface: 'street', curve: 'corner' },
  { x: 850, y: 650, surface: 'street', curve: 'corner' },
  { x: 0, y: 650, surface: 'street', curve: 'corner' },
  { x: 0, y: 0, surface: 'street', curve: 'corner' },
], EMPTY_TERRAIN)

function apexIndex() {
  return path.points.findIndex((point, i) =>
    point.structure === 'surface' && Math.abs(turnAmountAt(path, i, 6)) > 0.235)
}

function distance(cut: { x: number, y: number }) {
  return Math.hypot(cut.x, cut.y)
}

describe('legal AI corner cutting', () => {
  it('can plan a brief shoulder excursion but never aims as far as forced recovery', () => {
    const apex = apexIndex()
    expect(apex).toBeGreaterThanOrEqual(0)
    const cut = plannedApexCut(path, apex, false, 'normal', 'green', 0, 0)
    expect(distance(cut)).toBeGreaterThan(ROAD_GEOMETRY.onRoadRadius)
    expect(distance(cut)).toBeLessThan(ROAD_GEOMETRY.onRoadRadius + 30)
    const hard = plannedApexCut(path, apex, false, 'hard', 'green', 0, 0)
    expect(distance(hard)).toBeGreaterThan(distance(cut))
    // Dirt-friendly chassis can venture farther; race car stays closer to pavement.
    const red = plannedApexCut(path, apex, false, 'normal', 'red', 0, 0)
    expect(distance(red)).toBeLessThan(distance(cut))
  })

  it('cuts the same physical inside even when racing the route backward', () => {
    const apex = apexIndex()
    const forward = plannedApexCut(path, apex, false, 'normal', 'green', 0, 0)
    const backward = plannedApexCut(path, apex, true, 'normal', 'green', 0, 0)
    expect(forward.x).toBeCloseTo(backward.x)
    expect(forward.y).toBeCloseTo(backward.y)
  })

  it('does not shorten straights, Easy racing, or an unsafe outward slide', () => {
    const straight = path.points.findIndex((point, i) =>
      point.distance > 200 && Math.abs(turnAmountAt(path, i, 6)) < 0.01)
    expect(straight).toBeGreaterThanOrEqual(0)
    expect(distance(plannedApexCut(path, straight, false, 'hard', 'green', 0, 0))).toBe(0)
    const apex = apexIndex()
    expect(distance(plannedApexCut(path, apex, false, 'easy', 'green', 0, 0))).toBe(0)
    expect(distance(plannedApexCut(path, apex, false, 'hard', 'green', 48, 55))).toBe(0)
  })

  it('does not aim an offroad shortcut into water', () => {
    const apex = apexIndex()
    const flooded = {
      ...path,
      terrainSurface: { ...path.terrainSurface, materialAt: () => 'water' as const },
    }
    expect(distance(plannedApexCut(flooded, apex, false, 'normal', 'green', 0, 0))).toBe(0)
  })
})
