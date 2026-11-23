import { describe, expect, it } from 'vitest'
import { BRIDGE_FALL_RESPAWN_SECONDS, trackBridgeFall } from '@/domain/race/bridgeFallRecovery'
import { createRace } from '@/domain/race/raceFactory'
import { recoverRacePlayer, stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import { addRecoveryTimePenalty, penalizedRaceTime, RECOVERY_TIME_PENALTY_SECONDS } from '@/domain/race/recoveryPenalty'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { requireFixture } from '../fixtures/requireFixture'

const path = buildRoadPath([
  { x: -300, y: 16, surface: 'street', structure: 'overpass' },
  { x: 300, y: 16, surface: 'street' },
], EMPTY_TERRAIN, undefined, 'point-to-point')

const start = () => {
  const race = createRace({
    path, routeKind: 'point-to-point', playerCar: 'blue', difficulty: 'normal', laps: 1,
    handling: 'arcade',
  })
  return { ...race, phase: 'running' as const }
}

describe('recovery penalty and elevated-road auto respawn', () => {
  it('adds 100 ms to the recovering player only, stacks across manual resets, and resets on a new race', () => {
    const initial = start()
    const once = recoverRacePlayer(initial)
    const twice = recoverRacePlayer(once)
    expect(once.elapsed).toBe(initial.elapsed)
    expect(once.vehicles[0]?.recoveryPenaltySeconds).toBeCloseTo(RECOVERY_TIME_PENALTY_SECONDS)
    expect(twice.vehicles[0]?.recoveryPenaltySeconds).toBeCloseTo(0.2)
    expect(twice.vehicles[1]?.recoveryPenaltySeconds).toBeUndefined()
    expect(penalizedRaceTime(10, requireFixture(twice.vehicles[0]))).toBeCloseTo(10.2)
    const paused = { ...twice, paused: true }
    expect(recoverRacePlayer(paused)).toBe(paused)
    expect(start().vehicles[0]?.recoveryPenaltySeconds).toBeUndefined()
  })

  it('starts a bridge fall only after losing raised support and cancels after rejoining it', () => {
    const prior = { ...requireFixture(start().vehicles[0]), structureRunId: 'bridge', grounded: true, z: 24 }
    const ordinaryExit = trackBridgeFall(prior, { ...prior, z: 0 }, true, null, 0, 1 / 60)
    expect(ordinaryExit.bridgeFallSeconds).toBeUndefined()

    const airborne = trackBridgeFall(prior, { ...prior, grounded: false, z: 23 }, false, null, 0, 1 / 60)
    expect(airborne.bridgeFallSeconds).toBeCloseTo(1 / 60)
    const landed = trackBridgeFall(airborne, { ...airborne, grounded: true, z: 0 }, false, null, 0, 1 / 60)
    expect(landed.bridgeFallSeconds).toBeCloseTo(2 / 60)
    const rejoined = trackBridgeFall(landed, { ...landed, grounded: true, z: 24 }, true, 'bridge', 24, 1 / 60)
    expect(rejoined.bridgeFallSeconds).toBeUndefined()
  })

  it('automatically recovers a player stranded below a bridge after two seconds', () => {
    const initial = start()
    const index = path.points.findIndex((point) => point.x >= 0)
    const point = requireFixture(path.points[index])
    const surface = path.roadSurface.at(index, point)
    expect(surface.structureHeight).toBeGreaterThan(0)
    let race: RaceState = {
      ...initial,
      vehicles: [{
        ...requireFixture(initial.vehicles[0]),
        x: point.x, y: point.y + 41, z: surface.height,
        pathIndex: index, lastRoadContactIndex: index,
        angle: Math.PI / 2, speed: 190, vx: 0, vy: 190,
        grounded: true, structureRunId: surface.structureRunId,
      }],
    }
    let startedAt: number | undefined
    let recoveredAt: number | undefined
    for (let frame = 0; frame < 155; frame++) {
      const tick = stepRace(race, { steering: 0, throttle: 0, braking: false }, 1 / 60, { next: () => 0.5 })
      race = tick.state
      const car = requireFixture(race.vehicles[0])
      if (startedAt === undefined && car.bridgeFallSeconds !== undefined) startedAt = race.elapsed
      if (tick.events.some((event) => event.type === 'vehicle-recovered' && event.vehicleId === 'player')) {
        recoveredAt = race.elapsed
        expect(car.bridgeFallSeconds).toBeUndefined()
        expect(car.recoveryPenaltySeconds).toBeCloseTo(0.1)
        expect(car.grounded).toBe(true)
        break
      }
    }
    expect(startedAt).toBeDefined()
    expect(recoveredAt).toBeDefined()
    expect((recoveredAt ?? 0) - (startedAt ?? 0)).toBeGreaterThanOrEqual(BRIDGE_FALL_RESPAWN_SECONDS - 0.05)
    expect((recoveredAt ?? 0) - (startedAt ?? 0)).toBeLessThanOrEqual(BRIDGE_FALL_RESPAWN_SECONDS + 0.05)
  })

  it('penalizes the official time without advancing the simulation clock', () => {
    const car = requireFixture(start().vehicles[0])
    const penalized = addRecoveryTimePenalty(addRecoveryTimePenalty(car))
    expect(penalizedRaceTime(12.5, penalized)).toBeCloseTo(12.7)
    expect(car.finishedAt).toBeNull()
    expect(penalized.finishedAt).toBeNull()
  })
})
