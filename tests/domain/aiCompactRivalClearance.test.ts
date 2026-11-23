// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import { advancePassingState } from '@/domain/race/ai/passingState'
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
    expect(aiOnly.ahead).toBeNull()
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
    expect(advancePassingState(driver, aiState, aroundAi, 'hard', 0.05).phase).toBe('follow')
    const aroundPlayer = compactAiTraffic({ ahead: humanAhead, nearby: [humanAhead] })
    expect(advancePassingState(driver, aiState, aroundPlayer, 'hard', 0.05).phase).toBe('passing')
  })
  it('nudges at most four units on a straight and never into a tight corner or near the player', () => {
    const ahead = observation(rival, 9)
    const traffic: TrafficState = { ahead, nearby: [ahead] }
    const nudge = aiCourtesyNudge(driver, traffic, 0.01, true)
    expect(Math.abs(nudge)).toBeGreaterThan(0)
    expect(Math.abs(nudge)).toBeLessThanOrEqual(4)
    expect(aiCourtesyNudge(driver, traffic, 0.12, true)).toBe(0)
    expect(aiCourtesyNudge(driver, traffic, 0.01, false)).toBe(0)
    expect(aiCourtesyNudge(driver, { ahead, nearby: [ahead, observation(player, 25)] }, 0.01, true)).toBe(0)
  })
})
