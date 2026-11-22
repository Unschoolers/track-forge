import { describe, expect, it } from 'vitest'
import { catchUpBonus, rivalCatchUp } from '@/domain/race/ai/catchUp'
import { AI_CATCH_UP } from '@/domain/config'
import { createRace } from '@/domain/race/raceFactory'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'
import { requireFixture } from '../fixtures/requireFixture'

const track = createStarterTrack(asTrackId('catch-up'), 1)
const path = buildRoadPath(track.points, track.terrain)

/** Arrange actual race progress rather than mocking the ranking algorithm. */
function trailingRivals() {
  const base = createRace({ path, playerCar: 'blue', difficulty: 'hard', laps: 2 })
  const [player, near, far] = base.vehicles
  const sampleSpacing = path.totalLength / path.points.length
  const playerIndex = Math.floor(path.points.length * 0.8)
  const nearIndex = playerIndex - Math.round(130 / sampleSpacing)
  const farIndex = playerIndex - Math.round(550 / sampleSpacing)
  expect(farIndex).toBeGreaterThan(0)
  const race: RaceState = {
    ...base,
    vehicles: [
      { ...requireFixture(player), lap: 1, nextSector: 4, pathIndex: playerIndex, speed: 200 },
      { ...requireFixture(near), lap: 1, nextSector: 4, pathIndex: nearIndex, speed: 200 },
      { ...requireFixture(far), lap: 1, nextSector: 4, pathIndex: farIndex, speed: 200 },
    ],
  }
  return { race, sampleSpacing, playerIndex, nearIndex }
}

function withPlayer(race: RaceState, changes: Partial<RaceVehicle>): RaceState {
  return {
    ...race,
    vehicles: [{ ...requireFixture(race.vehicles[0]), ...changes }, ...race.vehicles.slice(1)],
  }
}

describe('AI catch-up', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0])(
    'does not assist for an invalid or non-trailing time gap of %s', gap => {
      expect(catchUpBonus(gap)).toBe(0)
    },
  )

  it('begins at the configured delay and gradually reaches its configured cap', () => {
    const { startGapSeconds, fullGapSeconds, initialSpeedBonus, maximumSpeedBonus } = AI_CATCH_UP
    expect(catchUpBonus(startGapSeconds - 0.001)).toBe(0)
    expect(catchUpBonus(startGapSeconds)).toBeCloseTo(initialSpeedBonus)
    const midpoint = catchUpBonus((startGapSeconds + fullGapSeconds) / 2)
    expect(midpoint).toBeGreaterThan(initialSpeedBonus)
    expect(midpoint).toBeLessThan(maximumSpeedBonus)
    expect(catchUpBonus(fullGapSeconds)).toBeCloseTo(maximumSpeedBonus)
    expect(catchUpBonus(fullGapSeconds + 100)).toBeCloseTo(maximumSpeedBonus)
  })

  it('increases with the gap but stops increasing at the configured ceiling', () => {
    expect(catchUpBonus(1)).toBeLessThan(catchUpBonus(2))
    expect(catchUpBonus(2)).toBeLessThan(catchUpBonus(4))
    expect(catchUpBonus(5)).toBe(catchUpBonus(100))
  })

  it('assists the far rival more than the near rival without depending on other rivals', () => {
    const { race } = trailingRivals()
    const near = requireFixture(race.vehicles[1])
    const far = requireFixture(race.vehicles[2])
    const nearBoost = requireFixture(rivalCatchUp(race, near))
    const farBoost = requireFixture(rivalCatchUp(race, far))
    expect(nearBoost.multiplier).toBeGreaterThan(1)
    expect(farBoost.multiplier).toBeGreaterThan(nearBoost.multiplier)
    expect(farBoost.multiplier).toBeLessThanOrEqual(1 + AI_CATCH_UP.maximumSpeedBonus)
    const withoutNear = { ...race, vehicles: [requireFixture(race.vehicles[0]), far] }
    expect(rivalCatchUp(withoutNear, far)).toEqual(farBoost)
  })

  it.each(['easy', 'normal', 'hard'] as const)(
    'does not change the assist with %s difficulty', (difficulty) => {
      const { race } = trailingRivals()
      const far = requireFixture(race.vehicles[2])
      expect(rivalCatchUp({ ...race, difficulty }, far))
        .toEqual(rivalCatchUp(race, far))
    },
  )

  it('does not assist a rival already ahead or within the catch-up threshold', () => {
    const { race, playerIndex, sampleSpacing } = trailingRivals()
    const far = requireFixture(race.vehicles[2])
    const close = { ...far, pathIndex: playerIndex - Math.round(70 / sampleSpacing) }
    const ahead = { ...far, pathIndex: playerIndex + Math.round(70 / sampleSpacing) }
    expect(rivalCatchUp(race, close)).toBeUndefined()
    expect(rivalCatchUp(race, ahead)).toBeUndefined()
  })

  it.each([
    ['finished', { finishedAt: 1 }],
    ['wrecked', { wrecked: true }],
    ['airborne', { grounded: false }],
    ['off road', { currentSurface: 'grass' as const }],
  ])('does not assist against a %s player', (_label, changes) => {
    const { race } = trailingRivals()
    const changed = withPlayer(race, changes)
    expect(rivalCatchUp(changed, requireFixture(changed.vehicles[2]))).toBeUndefined()
  })

  it.each([
    ['finished', { finishedAt: 1 }],
    ['wrecked', { wrecked: true }],
  ])('does not assist a %s rival', (_label, changes) => {
    const { race } = trailingRivals()
    const rival = { ...requireFixture(race.vehicles[2]), ...changes }
    expect(rivalCatchUp(race, rival)).toBeUndefined()
  })

  it('uses a speed floor for stationary cars instead of inventing an infinite time gap', () => {
    const { race } = trailingRivals()
    const stationary = withPlayer(race, { speed: 0 })
    const far = { ...requireFixture(stationary.vehicles[2]), speed: 0 }
    const bonus = requireFixture(rivalCatchUp(stationary, far))
    expect(Number.isFinite(bonus.multiplier)).toBe(true)
    expect(bonus.multiplier).toBeGreaterThan(1)
    expect(bonus.multiplier).toBeLessThanOrEqual(1 + AI_CATCH_UP.maximumSpeedBonus)
  })
})
