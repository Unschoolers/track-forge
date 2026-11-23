import { describe, expect, it } from 'vitest'
import { requireFixture } from '../fixtures/requireFixture'
import { advancePassingState } from '@/domain/race/ai/passingState'
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

  it('abandons a failed pass when the leader pulls away, but never rejoins into traffic', () => {
    const passing = {
      ...createAiDriverState(0, 'steady'),
      phase: 'passing' as const, passTargetId: other.id,
      passLane: 24, targetLane: 24, holdRemaining: 0,
      clearTime: 0.23, passElapsed: 3,
    }
    const escaping = {
      ...observation(75, 0),
      vehicle: { ...other, lane: 0, speed: vehicle.speed + 20 },
    }
    const safe = advancePassingState({ ...vehicle, lane: 24 }, passing,
      { ahead: escaping, nearby: [escaping] }, 'hard', 0.05)
    expect(safe.phase).toBe('rejoin')
    expect(safe.targetLane).toBe(0)

    const occupied = { ...observation(3, 0), vehicle: { ...other, id: 'blocker' } }
    const blocked = advancePassingState({ ...vehicle, lane: 24 }, passing,
      { ahead: escaping, nearby: [escaping, occupied] }, 'hard', 0.05)
    expect(blocked.phase).toBe('passing')
    expect(blocked.targetLane).toBe(24)

    const stillCatchable = advancePassingState({ ...vehicle, lane: 24 }, passing,
      { ahead: null, nearby: [{ ...escaping, vehicle: { ...other, speed: vehicle.speed - 15 } }] },
      'hard', 0.05)
    expect(stillCatchable.phase).toBe('passing')
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
