import { describe, expect, it } from 'vitest'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { planCornerTactics } from '@/domain/race/ai/cornerTactics'
import { turnAmountAt } from '@/domain/race/trackContext'

const path = buildRoadPath([
  { x: 0, y: 0, surface: 'dirt', curve: 'corner' },
  { x: 500, y: 0, surface: 'dirt', curve: 'corner' },
  { x: 500, y: 450, surface: 'dirt', curve: 'corner' },
  { x: 0, y: 450, surface: 'dirt', curve: 'corner' },
  { x: 0, y: 0, surface: 'dirt', curve: 'corner' },
], EMPTY_TERRAIN)

const tactics = (index: number, slipAngle = 0, offset = 0, reversed = false) =>
  planCornerTactics(path, index, reversed, 150, slipAngle, offset, 42)

describe('AI corner tactics', () => {
  it('previews a sharp corner before turn-in and returns to straight driving', () => {
    const approach = path.points.findIndex(p => p.distance > 400)
    const straight = path.points.findIndex(p => p.distance > 180)
    expect(tactics(straight).phase).toBe('straight')
    expect(tactics(approach).phase).toBe('approach')
    expect(tactics(approach).headingLead).toBeGreaterThan(0)
    expect(tactics(straight).headingLead).toBe(0)
    expect(tactics(approach).pursuitScale).toBeLessThanOrEqual(1)
  })

  it('countersteers a real slide but never manufactures one near the road edge', () => {
    const turnIndex = path.points.findIndex((_p, i) => tactics(i).phase === 'turn')
    const maxBend = Math.max(...path.points.map((_p, i) => Math.abs(turnAmountAt(path, i, 6))))
    expect(turnIndex, `road samples=${path.points.length}; maximum local bend=${maxBend}`).toBeGreaterThanOrEqual(0)
    const planted = tactics(turnIndex)
    const sliding = tactics(turnIndex, 0.17, 6)
    const wide = tactics(turnIndex, 0.17, 35)
    expect(planted.drifting).toBe(false)
    expect(sliding.drifting).toBe(true)
    expect(sliding.sideslipGain).toBeGreaterThan(planted.sideslipGain)
    expect(wide.drifting).toBe(false)
  })

  it('waits for lateral momentum to return before accelerating out of a bend', () => {
    const turnIndex = path.points.findIndex((_point, index) => tactics(index).phase === 'turn')
    expect(turnIndex).toBeGreaterThanOrEqual(0)
    const plan = (lateralVelocity: number) =>
      planCornerTactics(path, turnIndex, false, 180, 0.14, -15, 42, lateralVelocity)
    expect(plan(-65).exitTraction).toBeLessThan(0.4)
    expect(plan(45).exitTraction).toBe(1)
    expect(plan(-65).drifting).toBe(true)
    const straightIndex = path.points.findIndex(point => point.distance > 180)
    expect(planCornerTactics(path, straightIndex, false, 180, 0.14, -15, 42, -65).exitTraction).toBe(1)
  })

  it('adds progressive exit power only for a controlled slide', () => {
    const exitIndex = path.points.findIndex((_p, i) => tactics(i).phase === 'exit')
    expect(exitIndex).toBeGreaterThanOrEqual(0)
    expect(tactics(exitIndex, 0, 6).exitThrottle).toBe(0)
    expect(tactics(exitIndex, 0.17, 6).exitThrottle).toBeGreaterThan(0)
  })

  it('keeps corner prediction usable when reversing across a closed-lap boundary', () => {
    const plans = path.points.map((_p, i) => tactics(i, 0, 0, true))
    expect(plans.some(plan => plan.phase === 'approach')).toBe(true)
    expect(plans.some(plan => plan.phase === 'turn')).toBe(true)
    expect(plans.every(plan => Number.isFinite(plan.headingLead))).toBe(true)
    expect(plans.some(plan => plan.turnSign < 0)).toBe(true)
  })
})
