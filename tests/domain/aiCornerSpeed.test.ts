import { describe, expect, it } from 'vitest'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { CAR_SPECS } from '@/domain/config'
import { racingPavementAllowance, safeEntrySpeedAhead, sweepingPavementAllowance } from '@/domain/race/ai/cornerSpeed'

const path = buildRoadPath([
  { x: 0, y: 0, surface: 'street', curve: 'corner' },
  { x: 500, y: 0, surface: 'street', curve: 'corner' },
  { x: 500, y: 400, surface: 'street', curve: 'corner' },
  { x: 0, y: 400, surface: 'street', curve: 'corner' },
  { x: 0, y: 0, surface: 'street', curve: 'corner' },
], EMPTY_TERRAIN)

describe('AI approach speed planning', () => {
  it('allows more pace on open pavement and backs off for sharp corners', () => {
    const straight = path.points.findIndex((point) => point.distance > 80)
    const approach = path.points.findIndex((point) => point.distance > 460)
    expect(sweepingPavementAllowance(path, straight, false)).toBe(1)
    expect(sweepingPavementAllowance(path, approach, false)).toBe(0)
    expect(sweepingPavementAllowance(path, straight, true)).toBe(0)
    expect(racingPavementAllowance(path, straight, false)).toBe(0)
    expect(racingPavementAllowance(path, approach, false)).toBe(0)
  })

  it('backs off at loose-surface transitions in both directions', () => {
    const straight = buildRoadPath([
      { x: 0, y: 0, surface: 'street' },
      { x: 1400, y: 0, surface: 'street' },
    ], EMPTY_TERRAIN, undefined, 'point-to-point')
    const index = straight.points.findIndex((point) => point.distance > 700)
    const mixed = {
      ...straight,
      points: straight.points.map((point, i) => i === index + 18 || i === index - 18
        ? { ...point, surface: 'dirt' as const } : point),
    }
    expect(sweepingPavementAllowance(straight, index, false)).toBe(1)
    expect(sweepingPavementAllowance(straight, index, true)).toBe(1)
    expect(sweepingPavementAllowance(mixed, index, false)).toBe(0)
    expect(sweepingPavementAllowance(mixed, index, true)).toBe(0)
    expect(racingPavementAllowance(straight, index, false)).toBe(1)
    expect(racingPavementAllowance(straight, index, true)).toBe(1)
    expect(racingPavementAllowance(mixed, index, false)).toBe(0)
    expect(racingPavementAllowance(mixed, index, true)).toBe(0)
  })

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
  it('budgets for the heavy Yellow chassis yaw response instead of treating grip as instant steering', () => {
    const approach = path.points.findIndex(point => point.distance > 355)
    const stock = safeEntrySpeedAhead(path, approach, false, 0.74, CAR_SPECS.yellow, 1, 'yellow')
    const nimbleVersion = {
      ...CAR_SPECS.yellow,
      steer: CAR_SPECS.green.steer,
      yawInertia: CAR_SPECS.green.yawInertia,
    }
    const agile = safeEntrySpeedAhead(path, approach, false, 0.74, nimbleVersion, 1, 'yellow')
    // The matched tire/brake package still needs at least 2% more corner reserve.
    expect(stock).toBeLessThan(agile * 0.98)
  })

  it('applies the sharp-bend safety floor only when requested', () => {
    const approach = path.points.findIndex((point) => point.distance > 355)
    const normal = safeEntrySpeedAhead(path, approach, false, 0.1, CAR_SPECS.blue, 1, 'blue')
    const hard = safeEntrySpeedAhead(path, approach, false, 0.1, CAR_SPECS.blue, 1, 'blue', true)
    expect(hard).toBeLessThan(normal)
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
