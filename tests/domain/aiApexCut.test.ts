import { describe, expect, it } from 'vitest'
import { ROAD_GEOMETRY } from '@/domain/config'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { turnAmountAt } from '@/domain/race/trackContext'
import { plannedApexCut } from '@/domain/race/ai/apexCut'

const sweep = buildRoadPath([
  { x: 0, y: 0, surface: 'street', curve: 'smooth' },
  { x: 220, y: 0, surface: 'street', curve: 'smooth' },
  { x: 340, y: 160, surface: 'street', curve: 'smooth' },
  { x: 360, y: 350, surface: 'street', curve: 'smooth' },
  { x: 360, y: 690, surface: 'street', curve: 'smooth' },
], EMPTY_TERRAIN, undefined, 'point-to-point')

const hairpin = buildRoadPath([
  { x: 0, y: 0, surface: 'street', curve: 'corner' },
  { x: 850, y: 0, surface: 'street', curve: 'corner' },
  { x: 850, y: 650, surface: 'street', curve: 'corner' },
  { x: 0, y: 650, surface: 'street', curve: 'corner' },
  { x: 0, y: 0, surface: 'street', curve: 'corner' },
], EMPTY_TERRAIN)

function distance(cut: { x: number, y: number }) {
  return Math.hypot(cut.x, cut.y)
}

function findCutIndex() {
  return sweep.points.findIndex((_point, i) =>
    distance(plannedApexCut(sweep, i, false, 'hard', 'green', 0, 0)) > 0)
}

describe('legal AI shoulder cutting', () => {
  it('cuts a stable sweeping apex, while Hard can use more shoulder than Normal', () => {
    const apex = findCutIndex()
    expect(apex, 'A smooth street bend should provide a legal inside line').toBeGreaterThanOrEqual(0)
    const normal = plannedApexCut(sweep, apex, false, 'normal', 'green', 0, 0)
    const hard = plannedApexCut(sweep, apex, false, 'hard', 'green', 0, 0)
    expect(distance(normal)).toBeGreaterThan(0)
    expect(distance(hard)).toBeGreaterThan(distance(normal))
    expect(distance(hard)).toBeLessThan(ROAD_GEOMETRY.onRoadRadius + 30)
    // Prove the planner can actually aim a little beyond the pavement edge.
    // A hypothetical offset that never reaches grass isn't an offroad cut.
    const maximumShoulder = Math.max(...sweep.points.map((_p, index) =>
      distance(plannedApexCut(sweep, index, false, 'hard', 'green', 0, 0))))
    expect(maximumShoulder).toBeGreaterThan(ROAD_GEOMETRY.onRoadRadius)
    const red = plannedApexCut(sweep, apex, false, 'normal', 'red', 0, 0)
    expect(distance(red)).toBeLessThan(distance(normal))
  })

  it('aims for the same physical inside in reverse', () => {
    const apex = findCutIndex()
    const forward = plannedApexCut(sweep, apex, false, 'normal', 'green', 0, 0)
    const backward = plannedApexCut(sweep, apex, true, 'normal', 'green', 0, 0)
    expect(forward.x).toBeCloseTo(backward.x)
    expect(forward.y).toBeCloseTo(backward.y)
  })

  it('refuses a sharp hairpin, straight, Easy shortcut, or uncontrolled slide', () => {
    const corner = hairpin.points.findIndex((_point, i) =>
      Math.abs(turnAmountAt(hairpin, i, 6)) > 0.25)
    expect(corner).toBeGreaterThanOrEqual(0)
    expect(distance(plannedApexCut(hairpin, corner, false, 'hard', 'green', 0, 0))).toBe(0)

    const straight = sweep.points.findIndex((point, i) =>
      point.distance > 90 && Math.abs(turnAmountAt(sweep, i, 6)) < 0.005)
    expect(straight).toBeGreaterThanOrEqual(0)
    expect(distance(plannedApexCut(sweep, straight, false, 'hard', 'green', 0, 0))).toBe(0)

    const apex = findCutIndex()
    expect(distance(plannedApexCut(sweep, apex, false, 'easy', 'green', 0, 0))).toBe(0)
    expect(distance(plannedApexCut(sweep, apex, false, 'hard', 'green', 55, 45))).toBe(0)
    expect(distance(plannedApexCut(sweep, apex, false, 'hard', 'green', 0, 0, 260))).toBe(0)
  })

  it('never intentionally cuts through water', () => {
    const apex = findCutIndex()
    const flooded = {
      ...sweep,
      terrainSurface: { ...sweep.terrainSurface, materialAt: () => 'water' as const },
    }
    expect(distance(plannedApexCut(flooded, apex, false, 'normal', 'green', 0, 0))).toBe(0)
  })
})
