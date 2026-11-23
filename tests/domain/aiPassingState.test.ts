import { describe, expect, it } from 'vitest'
import { requireFixture } from '../fixtures/requireFixture'
import { advancePassingState } from '@/domain/race/ai/passingState'
import { CAR_PASSING_POLICIES, validatePassingPolicy } from '@/domain/race/ai/aiCarPassingPolicies'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import { createRace } from '@/domain/race/raceFactory'
import { asTrackId } from '@/domain/model'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createStarterTrack } from '@/domain/track/starterTrack'
import type { TrafficObservation, TrafficState } from '@/domain/race/ai/traffic'

const track = createStarterTrack(asTrackId('ai-passing-policy'), 1)
const path = buildRoadPath(track.points, track.terrain)
const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2 })
const first = requireFixture(race.vehicles[0])
const other = requireFixture(race.vehicles[1])
const vehicle = { ...first, speed: 160, lane: 0 }

function observation(signedDistance: number, lane = 0): TrafficObservation {
  return {
    vehicle: { ...other, lane, speed: 20 },
    signedDistance,
    distance: Math.abs(signedDistance),
    laneGap: Math.abs(lane),
    relativeSpeed: 140,
    timeToCollision: 0.4,
  }
}

describe('AI overtake decision policy', () => {
  it('starts a pass only for a slower, nearby car with a clear alternative lane', () => {
    const approaching = observation(30)
    const traffic: TrafficState = { ahead: approaching, nearby: [approaching] }
    const follow = createAiDriverState(0, 'opportunist')
    const started = advancePassingState(vehicle, follow, traffic, 'normal', 0.05)
    expect(started).toMatchObject({
      phase: 'passing', passTargetId: other.id, holdRemaining: expect.any(Number),
    })
    expect(started.targetLane).not.toBe(0)
    expect(follow.phase).toBe('follow')
    expect(advancePassingState(vehicle, follow, { ahead: null, nearby: [] }, 'normal', 0.05).phase).toBe('follow')
  })

  it('applies Red-only abandon timing without changing Yellow passing behavior', () => {
    const passing = {
      ...createAiDriverState(0), phase: 'passing' as const,
      passLane: 24, targetLane: 24, holdRemaining: 0, clearTime: 0.22,
      passTargetId: other.id, passElapsed: 5,
    }
    const target = observation(80, 0)
    const traffic: TrafficState = { ahead: target, nearby: [target] }
    const red = { ...CAR_PASSING_POLICIES.red, abandonAfterSeconds: 4 }
    const redResult = advancePassingState({ ...vehicle, car: 'red', lane: 24 },
      passing, traffic, 'hard', 0.1, red)
    expect(redResult.phase).toBe('rejoin')
    expect(redResult.targetLane).toBe(0)

    const yellowResult = advancePassingState({ ...vehicle, car: 'yellow', lane: 24 },
      passing, traffic, 'hard', 0.1)
    expect(yellowResult.phase).toBe('passing')
    expect(yellowResult.targetLane).toBe(24)
    expect(CAR_PASSING_POLICIES.yellow.abandonAfterSeconds).toBe(8)
    expect(CAR_PASSING_POLICIES.red.abandonAfterSeconds).toBe(8)
  })

  it('rejects invalid passing values rather than normalizing an unsafe policy', () => {
    expect(() => validatePassingPolicy({
      ...CAR_PASSING_POLICIES.red, abandonAfterSeconds: Number.NaN,
    })).toThrow(/Invalid car-specific passing policy/)
  })

  it('holds the passing lane while the base lane is occupied, then rejoins after sustained clearance', () => {
    const passing = {
      ...createAiDriverState(0), phase: 'passing' as const,
      passLane: 24, targetLane: 24, holdRemaining: 0, clearTime: 0.2,
      passTargetId: other.id, passElapsed: 3,
    }
    const blocked = advancePassingState({ ...vehicle, lane: 24 }, passing,
      { ahead: null, nearby: [observation(2, 0)] }, 'normal', 0.3)
    expect(blocked.phase).toBe('passing')
    expect(blocked.targetLane).toBe(24)

    const rejoin = advancePassingState({ ...vehicle, lane: 24 }, passing,
      { ahead: null, nearby: [] }, 'normal', 0.3)
    expect(rejoin.phase).toBe('rejoin')
    expect(rejoin.targetLane).toBe(0)
    const followed = advancePassingState({ ...vehicle, lane: 0 }, rejoin,
      { ahead: null, nearby: [] }, 'normal', 0.1)
    expect(followed.phase).toBe('follow')
    expect(followed.cooldownRemaining).toBeGreaterThan(0)
  })
})
