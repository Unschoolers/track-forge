// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import { advancePassingState } from '@/domain/race/ai/passingState'
import { stepAiVehicle } from '@/domain/race/ai/aiDriver'
import { aiCourtesyNudge, compactAiTraffic } from '@/domain/race/ai/aiRivalClearance'
import type { TrafficObservation, TrafficState } from '@/domain/race/ai/traffic'

const track = createStarterTrack(asTrackId('ai-small-rival-hitbox'), 1)
const path = buildRoadPath(track.points, track.terrain)
const race = createRace({ path, playerCar: 'green', difficulty: 'hard', laps: 2 })
const first = race.vehicles[1]
const human = race.vehicles[0]
const second = race.vehicles[2]
if (!first || !human || !second) throw new Error('Missing race grid fixtures')
const driver = { ...first, speed: 180, lane: 0, player: false }
const player = { ...human, speed: 70, lane: 0, player: true }
const rival = { ...second, speed: 80, lane: 0, player: false }
function observation(other: typeof player, distance: number, laneGap = 0): TrafficObservation {
  return {
    vehicle: other, signedDistance: distance, distance: Math.abs(distance),
    laneGap, relativeSpeed: Math.max(0, driver.speed - other.speed),
    timeToCollision: distance > 0 ? distance / Math.max(1, driver.speed - other.speed) : Infinity,
  }
}
describe('Arcade non-colliding AI cars have point-sized traffic awareness', () => {
  it('ignores large rival AI avoidance envelopes but preserves the full human envelope', () => {
    const distantAi = observation(rival, 30)
    const closeAi = observation(rival, 5, 2)
    const adjacentAi = observation(rival, 4, 9)
    const humanAhead = observation(player, 35)
    const aiOnly = compactAiTraffic({ ahead: distantAi, nearby: [distantAi, closeAi, adjacentAi] })
    expect(aiOnly.ahead).toBe(closeAi)
    expect(aiOnly.nearby).toEqual([closeAi])

    const mixed = compactAiTraffic({ ahead: humanAhead,
      nearby: [distantAi, humanAhead, closeAi] })
    expect(mixed.ahead).toBe(humanAhead)
    expect(mixed.nearby).toEqual([humanAhead, closeAi])
    // A nearer AI must not hide the human from the passing controller.
    const behindRival = compactAiTraffic({ ahead: closeAi,
      nearby: [closeAi, humanAhead] })
    expect(behindRival.ahead).toBe(humanAhead)
  })
  it('does not start an extreme AI-to-AI pass, but still overtakes a human', () => {
    const aiState = createAiDriverState(0, 'opportunist')
    const ai = observation(rival, 30)
    const humanAhead = observation(player, 30)
    const aroundAi = compactAiTraffic({ ahead: ai, nearby: [ai] })
    expect(advancePassingState(driver, aiState,
      { ...aroundAi, ahead: null }, 'hard', 0.05).phase).toBe('follow')
    const aroundPlayer = compactAiTraffic({ ahead: humanAhead, nearby: [humanAhead] })
    expect(advancePassingState(driver, aiState, aroundPlayer, 'hard', 0.05).phase).toBe('passing')
  })
  it.each(['red', 'blue', 'green', 'yellow'] as const)('uses compact rivals for %s in every driving style and difficulty', car => {
    for (const handling of ['arcade', 'simulation'] as const) {
      for (const difficulty of ['easy', 'normal', 'hard'] as const) {
        for (const racingLine of [undefined, { sections: [], speedRatio: 1 }]) {
          const aiDriver = { ...driver, car, ...(racingLine ? { racingLine } : {}), ai: createAiDriverState(0, 'opportunist') }
          for (const speed of [50, 80, 120]) {
            const slowerAi = observation({ ...rival, speed }, 30)
            const slowerHuman = observation({ ...player, speed }, 30)
            const aroundAi = stepAiVehicle(aiDriver, path, { ahead: slowerAi, nearby: [slowerAi] },
              difficulty, 1 / 60, undefined, false, Infinity, handling)
            const aroundHuman = stepAiVehicle(aiDriver, path, { ahead: slowerHuman, nearby: [slowerHuman] },
              difficulty, 1 / 60, undefined, false, Infinity, handling)
            expect(aroundAi.ai?.phase).toBe('follow')
            expect(aroundHuman.ai?.phase).toBe('passing')
          }
        }
      }
    }
  })
  it('nudges at most four units on a straight and never into a tight corner or near the player', () => {
    const ahead = observation(rival, 9)
    const traffic: TrafficState = { ahead, nearby: [ahead] }
    const slowerDriver = { ...driver, speed: 130 }
    const nudge = aiCourtesyNudge(slowerDriver, traffic, 0.01, true)
    expect(Math.abs(nudge)).toBeGreaterThan(0)
    expect(Math.abs(nudge)).toBeLessThanOrEqual(2)
    expect(aiCourtesyNudge(driver, traffic, 0.01, true)).toBe(0)
    expect(aiCourtesyNudge(slowerDriver, traffic, 0.12, true)).toBe(0)
    expect(aiCourtesyNudge(slowerDriver, traffic, 0.01, false)).toBe(0)
    expect(aiCourtesyNudge(slowerDriver, { ahead, nearby: [ahead, observation(player, 25)] }, 0.01, true)).toBe(0)
  })
})
