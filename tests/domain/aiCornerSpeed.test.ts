import { describe, expect, it } from 'vitest'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { CAR_SPECS } from '@/domain/config'
import { safeEntrySpeedAhead } from '@/domain/race/ai/cornerSpeed'

const path = buildRoadPath([
  { x: 0, y: 0, surface: 'street', curve: 'corner' },
  { x: 500, y: 0, surface: 'street', curve: 'corner' },
  { x: 500, y: 400, surface: 'street', curve: 'corner' },
  { x: 0, y: 400, surface: 'street', curve: 'corner' },
  { x: 0, y: 0, surface: 'street', curve: 'corner' },
], EMPTY_TERRAIN)

describe('AI approach speed planning', () => {
  it('slows for a bend ahead instead of waiting for the target to enter the corner', () => {
    const straight = path.points.findIndex((point) => point.distance > 80 && point.distance < 120)
    const approach = path.points.findIndex((point) => point.distance > 355 && point.distance < 365)
    expect(straight).toBeGreaterThan(0)
    expect(approach).toBeGreaterThan(0)
    const early = safeEntrySpeedAhead(path, straight, false, 1)
    const late = safeEntrySpeedAhead(path, approach, false, 1)
    expect(late).toBeLessThan(225)
    expect(late).toBeLessThan(early)
  })
  it('uses car and surface capability for straight and bend approach speeds', () => {
    const straight = path.points.findIndex((point) => point.distance > 80)
    const approach = path.points.findIndex((point) => point.distance > 355)
    const ice = { ...path, points: path.points.map((point) => ({ ...point, surface: 'ice' as const })) }
    expect(safeEntrySpeedAhead(path, straight, false, 0.74, CAR_SPECS.red, 1)).toBeGreaterThan(243)
    expect(safeEntrySpeedAhead(ice, approach, false, 1, CAR_SPECS.blue, 1))
      .toBeLessThan(safeEntrySpeedAhead(path, approach, false, 1, CAR_SPECS.blue, 1))
  })
  it('uses physical travel direction and wraps a closed lap in reverse', () => {
    const nearStart = path.points.findIndex((point) => point.distance > 20)
    const nearEnd = path.points.findIndex((point) => point.distance > path.totalLength - 30)
    const forward = safeEntrySpeedAhead(path, nearEnd, false, 1)
    const reverse = safeEntrySpeedAhead(path, nearStart, true, 1)
    expect(Number.isFinite(forward)).toBe(true)
    expect(Number.isFinite(reverse)).toBe(true)
    expect(forward).toBeGreaterThanOrEqual(70)
    expect(reverse).toBeGreaterThanOrEqual(70)
    expect(forward).toBeLessThanOrEqual(225)
    expect(reverse).toBeLessThanOrEqual(225)
  })
})
