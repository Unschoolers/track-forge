import { describe, expect, it } from 'vitest'
import { catchUpBonus, rivalCatchUp } from '@/domain/race/ai/catchUp'
import { createRace } from '@/domain/race/raceFactory'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'

const track = createStarterTrack(asTrackId('catch-up'), 1)
const path = buildRoadPath(track.points, track.terrain)

describe('AI catch-up', () => {
  it('starts at 1% at 500ms, stays quadratic, and caps at 12% on every difficulty', () => {
    expect(catchUpBonus(0)).toBe(0)
    expect(catchUpBonus(0.499)).toBe(0)
    expect(catchUpBonus(0.5)).toBeCloseTo(0.01)
    expect(catchUpBonus(1)).toBeCloseTo(0.01 + 0.11 * (0.5 / 4.5) ** 2)
    expect(catchUpBonus(2)).toBeCloseTo(0.01 + 0.11 * (1.5 / 4.5) ** 2)
    expect(catchUpBonus(5)).toBeCloseTo(0.12)
    expect(catchUpBonus(20)).toBeCloseTo(0.12)
    expect(catchUpBonus(Number.NaN)).toBe(0)
  })

  it('calculates independent boosts from each rival’s progress, independent of difficulty', () => {
    const base = createRace({ path, playerCar: 'blue', difficulty: 'hard', laps: 2 })
    const [player, near, far] = base.vehicles
    if (!player || !near || !far) throw new Error('Missing cars')
    const sampleSpacing = path.totalLength / path.points.length
    const playerIndex = Math.floor(path.points.length * 0.8)
    const nearIndex = playerIndex - Math.round(130 / sampleSpacing)
    const farIndex = playerIndex - Math.round(550 / sampleSpacing)
    expect(farIndex).toBeGreaterThan(0)
    const arranged = {
      ...base,
      vehicles: [
        { ...player, lap: 1, pathIndex: playerIndex, speed: 200 },
        { ...near, lap: 1, pathIndex: nearIndex, speed: 200 },
        { ...far, lap: 1, pathIndex: farIndex, speed: 200 },
      ],
    }
    const nearBonus = rivalCatchUp(arranged, arranged.vehicles[1]!)
    const farBonus = rivalCatchUp(arranged, arranged.vehicles[2]!)
    expect(nearBonus?.multiplier).toBeGreaterThan(1)
    expect(farBonus?.multiplier).toBeGreaterThan(nearBonus?.multiplier ?? Infinity)
    expect(rivalCatchUp({ ...arranged, difficulty: 'easy' }, arranged.vehicles[2]!))
      .toEqual(farBonus)
    expect(rivalCatchUp({ ...arranged, difficulty: 'normal' }, arranged.vehicles[2]!))
      .toEqual(farBonus)
    expect(rivalCatchUp({ ...arranged, vehicles: [
      { ...arranged.vehicles[0]!, pathIndex: nearIndex + Math.round(70 / sampleSpacing) },
      arranged.vehicles[1]!,
      arranged.vehicles[2]!,
    ] }, arranged.vehicles[1]!)).toBeUndefined()
  })
})
