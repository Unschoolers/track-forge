import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { getTrafficState } from '@/domain/race/ai/traffic'
import {
  choosePassingLane,
  scorePassingLane,
} from '@/domain/race/ai/lanePlanner'
import { stepAiVehicle } from '@/domain/race/ai/aiDriver'
import { createAiDriverState } from '@/domain/race/ai/aiState'

const track = createStarterTrack(asTrackId('starter'), 1)
const path = buildRoadPath(track.points, track.terrain)

function cars() {
  return createRace({
    path,
    playerCar: 'blue',
    difficulty: 'normal',
    laps: 3,
  }).vehicles
}

describe('overtaking AI', () => {
  it('finds traffic ahead across the path wrap boundary', () => {
    const [ego, rival] = cars()
    if (!ego || !rival) throw new Error('Missing race fixtures')
    const traffic = getTrafficState(
      { ...ego, pathIndex: path.points.length - 4 },
      [{ ...rival, pathIndex: 3 }],
      path.points.length,
    )

    expect(traffic.ahead?.vehicle.id).toBe(rival.id)
    expect(traffic.ahead?.distance).toBe(7)
  })

  it('rejects an occupied lane and chooses the clearest alternative', () => {
    const [ego, rival] = cars()
    if (!ego || !rival) throw new Error('Missing race fixtures')
    const traffic = getTrafficState(
      { ...ego, lane: 0, pathIndex: 10 },
      [{ ...rival, lane: -24, pathIndex: 15 }],
      path.points.length,
    )

    expect(scorePassingLane(-24, traffic, 'normal')).toBeLessThan(
      scorePassingLane(24, traffic, 'normal'),
    )
    expect(choosePassingLane({ ...ego, lane: 0 }, traffic, 'normal')).toBe(-8)
  })

  it('steers an AI car toward the path and brakes for emergency traffic', () => {
    const [ego, rival] = cars()
    if (!ego || !rival) throw new Error('Missing race fixtures')
    const moving = { ...ego, player: false, speed: 120, pathIndex: 10 }
    const traffic = getTrafficState(
      moving,
      [{ ...rival, speed: 10, pathIndex: 11 }],
      path.points.length,
    )
    const stepped = stepAiVehicle(
      {
        ...moving,
        ai: createAiDriverState(0),
        vx: 120,
      },
      path,
      traffic,
      'hard',
      0.1,
      { next: () => 0.5 },
    )

    expect(stepped.speed).toBeLessThan(moving.speed)
    expect(Number.isFinite(stepped.angle)).toBe(true)
  })

  it('commits to a passing lane and does not oscillate while holding it', () => {
    const [, ego, rival] = cars()
    if (!ego || !rival) throw new Error('Missing race fixtures')
    const moving = {
      ...ego,
      speed: 110,
      vx: 110,
      lane: 0,
      pathIndex: 10,
      ai: createAiDriverState(0),
    }
    const traffic = getTrafficState(
      moving,
      [{ ...rival, speed: 45, pathIndex: 16, lane: 0 }],
      path.points.length,
    )
    const passing = stepAiVehicle(
      moving,
      path,
      traffic,
      'normal',
      0.1,
      { next: () => 0.5 },
    )
    const committedLane = passing.ai?.passLane
    const changedTraffic = getTrafficState(
      passing,
      [{ ...rival, speed: 45, pathIndex: 17, lane: committedLane ?? 0 }],
      path.points.length,
    )
    const held = stepAiVehicle(
      passing,
      path,
      changedTraffic,
      'normal',
      0.1,
      { next: () => 0.5 },
    )

    expect(passing.ai).toMatchObject({
      phase: 'passing',
      targetLane: committedLane,
    })
    expect(committedLane).not.toBe(0)
    expect(held.ai?.passLane).toBe(committedLane)
  })

  it('applies seeded mistakes only through the injected random source', () => {
    const [, ego] = cars()
    if (!ego) throw new Error('Missing AI fixture')
    const base = {
      ...ego,
      ai: {
        ...createAiDriverState(0),
        mistakeRemaining: 0,
      },
    }
    const traffic = getTrafficState(base, [], path.points.length)
    const mistake = stepAiVehicle(
      base,
      path,
      traffic,
      'easy',
      1,
      { next: () => 0 },
    )
    const clean = stepAiVehicle(
      base,
      path,
      traffic,
      'easy',
      1,
      { next: () => 0.99 },
    )

    expect(mistake.ai?.mistakeOffset).not.toBe(0)
    expect(clean.ai?.mistakeOffset).toBe(0)
  })

  it('rejoins its base lane after clearance and starts a cooldown', () => {
    const [, ego] = cars()
    if (!ego) throw new Error('Missing AI fixture')
    const passing = {
      ...ego,
      lane: 20,
      ai: {
        ...createAiDriverState(0),
        phase: 'passing' as const,
        targetLane: 20,
        passLane: 20,
        holdRemaining: 0,
      },
    }
    const cleared = stepAiVehicle(
      passing,
      path,
      getTrafficState(passing, [], path.points.length),
      'normal',
      0.3,
      { next: () => 0.5 },
    )
    expect(cleared.ai).toMatchObject({
      phase: 'rejoin',
      targetLane: 0,
    })

    const centered = { ...cleared, lane: 1 }
    const rejoined = stepAiVehicle(
      centered,
      path,
      getTrafficState(centered, [], path.points.length),
      'normal',
      0.1,
      { next: () => 0.5 },
    )
    expect(rejoined.ai?.phase).toBe('follow')
    expect(rejoined.ai?.cooldownRemaining).toBeGreaterThan(0)
  })
})
