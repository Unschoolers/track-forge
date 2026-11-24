import { describe, expect, it } from 'vitest'
import { BRIDGE_FALL_RESPAWN_SECONDS, trackBridgeFall } from '@/domain/race/bridgeFallRecovery'
import { createRace } from '@/domain/race/raceFactory'
import { recoverRacePlayer, stepRace, stepRaceTick } from '@/domain/race/raceEngine'
import { recoverRaceVehicle } from '@/domain/race/raceRecovery'
import { manualRecoverySignal } from '@/application/race/racePresentation'
import { MANUAL_RECOVERY_TICKS, manualRecoveryTicksRemaining, type RaceState } from '@/domain/race/raceState'
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

describe('manual recovery hold and elevated-road auto respawn', () => {
  it('ignores repeated requests until release and starts a fresh hold on the next manual recovery', () => {
    const initial = start()
    const once = recoverRacePlayer(initial)
    expect(recoverRacePlayer(once)).toBe(once)
    let released: RaceState = once
    for (let tick = 0; tick < MANUAL_RECOVERY_TICKS; tick++) {
      released = stepRace(released, { steering: 0, throttle: 1, braking: false }, 1 / 60, { next: () => 0.5 }).state
    }
    const twice = recoverRacePlayer(released)
    expect(once.elapsed).toBe(initial.elapsed)
    expect(once.vehicles[0]?.manualRecoveryUntilTick).toBe(30)
    expect(twice.vehicles[0]?.manualRecoveryUntilTick).toBe(60)
    expect(twice.vehicles[1]?.manualRecoveryUntilTick).toBeUndefined()
    expect(twice.elapsed).toBeCloseTo(0.5, 10)
    const paused = { ...twice, paused: true }
    expect(recoverRacePlayer(paused)).toBe(paused)
    expect(start().vehicles[0]?.manualRecoveryUntilTick).toBeUndefined()
  })

  it('holds human and AI manual requests for exactly 30 running ticks and shows only the human signal', () => {
    for (const handling of ['arcade', 'simulation'] as const) {
      const initial = { ...start(), handling }
      const player = requireFixture(initial.vehicles[0])
      const rival = requireFixture(initial.vehicles[1])
      const input = { steering: 0, throttle: 1, braking: false }
      const random = { next: () => 0.5 }
      let race = recoverRaceVehicle(initial, rival.id)
      expect(manualRecoverySignal(race)).toBeNull()
      race = recoverRacePlayer(race)
      const held = race.vehicles.slice(0, 2).map(vehicle => ({ x: vehicle.x, y: vehicle.y, speed: vehicle.speed }))
      expect(manualRecoverySignal(race)?.color).toBe(0xfacc15)
      expect(manualRecoverySignal(race)?.progress).toBe(0)
      const paused = { ...race, paused: true }
      expect(stepRace(paused, input, 1 / 60, random).state).toBe(paused)
      for (let tick = 1; tick <= MANUAL_RECOVERY_TICKS; tick++) {
        race = stepRaceTick(race, { tick, controls: { [player.id]: input, [rival.id]: input } }, random).state
        expect(race.vehicles.slice(0, 2).map(vehicle => ({ x: vehicle.x, y: vehicle.y, speed: vehicle.speed }))).toEqual(held)
        expect(race.elapsed).toBeCloseTo(tick / 60, 10)
        expect(manualRecoveryTicksRemaining(race.vehicles[0], tick)).toBe(MANUAL_RECOVERY_TICKS - tick)
      }
      expect(manualRecoverySignal(race)?.color).toBe(0x4ade80)
      race = stepRaceTick(race, { tick: MANUAL_RECOVERY_TICKS + 1, controls: { [player.id]: input, [rival.id]: input } }, random).state
      expect(race.vehicles[0]?.speed).toBeGreaterThan(0)
      expect(race.vehicles[1]?.speed).toBeGreaterThan(0)
      expect(manualRecoverySignal({ ...race, tick: MANUAL_RECOVERY_TICKS + 18 })).toBeNull()
    }
  })

  it('starts a bridge fall only after losing raised support and cancels after rejoining it', () => {
    const prior = { ...requireFixture(start().vehicles[0]), structureRunId: 'bridge', grounded: true, z: 24 }
    const ordinaryExit = trackBridgeFall(prior, { ...prior, z: 0 }, true, null, 0, 1 / 60)
    expect(ordinaryExit.bridgeFallSeconds).toBeUndefined()

    const airborne = trackBridgeFall(prior, { ...prior, grounded: false, z: 23 }, false, null, 0, 1 / 60)
    expect(airborne.bridgeFallSeconds).toBeCloseTo(1 / 60)
    const lowerArm = trackBridgeFall(prior, { ...prior, grounded: false, z: 23 }, true, null, 0, 1 / 60)
    expect(lowerArm.bridgeFallSeconds).toBeCloseTo(1 / 60)
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
        expect(manualRecoveryTicksRemaining(car, race.tick)).toBe(0)
        expect(car.grounded).toBe(true)
        break
      }
    }
    expect(startedAt).toBeDefined()
    expect(recoveredAt).toBeDefined()
    expect((recoveredAt ?? 0) - (startedAt ?? 0)).toBeGreaterThanOrEqual(BRIDGE_FALL_RESPAWN_SECONDS - 0.05)
    expect((recoveredAt ?? 0) - (startedAt ?? 0)).toBeLessThanOrEqual(BRIDGE_FALL_RESPAWN_SECONDS + 0.05)
  })

})
