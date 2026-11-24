import { describe, expect, it, vi } from 'vitest'
import { ROAD_GEOMETRY } from '@/domain/config'
import { advanceArcadeTimingGate } from '@/domain/race/arcadeTimingGate'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { roadGateGeometry, roadGateSpan } from '@/domain/track/trackGeometry'
import { createLaneScenarios, prepareLanePath } from '../../qa/lanes/scenarios'

const motion = vi.hoisted(() => new Map<string, { x: number; y: number }>())
vi.mock('@/domain/race/vehiclePhysics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/race/vehiclePhysics')>()
  return { ...actual, stepVehicle: (vehicle: import('@/domain/race/raceState').RaceVehicle) =>
    ({ ...vehicle, ...motion.get(vehicle.id) }) }
})
const street = (x: number, y: number) => ({ x, y, surface: 'street' as const, curve: 'corner' as const })
const path = buildRoadPath([street(0, 0), street(800, 0), street(800, 800), street(0, 800), street(0, 0)], EMPTY_TERRAIN)
const input = { throttle: 0, steering: 0, braking: false }
const random = { next: () => 0.5 }

describe('shared checkpoint authority', () => {
  it('does not miss the finish while following the road into a sharp start corner', () => {
    const fixture = createLaneScenarios().find(track => track.id === 'hairpin')
    if (!fixture) throw new Error('Missing hairpin fixture')
    const road = prepareLanePath(fixture)
    const race = createRace({ path: road, playerCar: 'blue', difficulty: 'normal', laps: 1, recoveryCheckpoints: [0.25, 0.5, 0.75] })
    const car = race.vehicles[0]!
    // Actual lane-check failure, seven to twelve samples before Start.
    const before = { ...car, player: false, x: -290.30348985865214, y: -119.33487130584501, pathIndex: 444, nextSector: 4 }
    const after = { ...before, x: -289.07875102012434, y: -121.47788609288719 }
    const result = advanceArcadeTimingGate(race, before, after, 15.516666666667017, true, () => true)
    expect(result.vehicle.finishedAt).toBeNull()
    expect(result.missedCheckpoint).toBeUndefined()
  })

  it.each([false, true])('accepts the contiguous inner verge at the curved finish (reversed=%s)', reversed => {
    const fixture = createLaneScenarios().find(track => track.id === 'hairpin')
    if (!fixture) throw new Error('Missing hairpin fixture')
    const road = prepareLanePath(fixture)
    const race = createRace({ path: road, playerCar: 'green', difficulty: 'normal', laps: 1, reversed, recoveryCheckpoints: [0.25, 0.5, 0.75] })
    const car = race.vehicles[0]!
    const span = roadGateSpan(road, 0, ROAD_GEOMETRY.onRoadRadius)
    expect(span.max).toBeGreaterThan(ROAD_GEOMETRY.onRoadRadius)
    const frames = reversed
      ? [{ x: -275.7530557507991, y: -126.74597995916382, pathIndex: 4 }, { x: -277.1709238643195, y: -125.0302176685622, pathIndex: 3 }]
      : [{ x: -278.75285549920636, y: -128.19263200717364, pathIndex: 445 }, { x: -276.9226688519395, y: -129.86613431269626, pathIndex: 445 }]
    for (const player of [false, true]) {
      const before = { ...car, player, ...frames[0]!, nextSector: 4 }
      const after = { ...before, ...frames[1]! }
      const result = advanceArcadeTimingGate(race, before, after, 18, !reversed, () => !reversed)
      expect(result.vehicle.finishedAt).toBe(18)
      expect(result.missedCheckpoint).toBeUndefined()
    }
  })

  it.each([false, true])('uses identical swept crossing and missed-gate rules for every car (reversed=%s)', reversed => {
    const race = createRace({ path, playerCar: 'yellow', difficulty: 'hard', laps: 2, reversed, recoveryCheckpoints: [0.125, 0.5, 0.875] })
    const gate = race.timingGates![0]!
    const { center: a, tangent } = roadGateGeometry(path, gate)!
    const tx = tangent.x * (reversed ? -1 : 1)
    const ty = tangent.y * (reversed ? -1 : 1)
    const at = (along: number, offset: number) => ({ x: a.x + tx * along - ty * offset, y: a.y + ty * along + tx * offset })
    const radius = ROAD_GEOMETRY.onRoadRadius + ROAD_GEOMETRY.checkpointGrace
    for (const car of race.vehicles) {
      const before = { ...car, ...at(-2, radius - 1), pathIndex: gate, nextSector: 1 }
      const valid = advanceArcadeTimingGate(race, before, { ...before, ...at(2, radius - 1) }, 3, false, () => false)
      expect(valid.vehicle.nextSector).toBe(2)
      expect(valid.missedCheckpoint).toBeUndefined()
      const invalid = { ...before, ...at(-2, radius + 8) }
      const missed = advanceArcadeTimingGate(race, invalid, { ...invalid, ...at(2, radius + 8) }, 3, false, () => false)
      expect(missed.vehicle.nextSector).toBe(1)
      expect(missed.missedCheckpoint).toMatchObject({ gate: 1, remainingSeconds: 2 })
      const backwards = advanceArcadeTimingGate(race, { ...before, ...at(2, 0) }, { ...before, ...at(-2, 0) }, 3, true, () => true)
      expect(backwards.vehicle.nextSector).toBe(1)
    }
  })

  it('keeps rival countdowns independent and returns a missed rival before its gate', () => {
    const stage = buildRoadPath([street(0, 0), street(800, 0)], EMPTY_TERRAIN, undefined, 'point-to-point')
    const race = createRace({ path: stage, routeKind: 'point-to-point', playerCar: 'blue', difficulty: 'hard', laps: 1, recoveryCheckpoints: [0.5] })
    const gate = race.timingGates![0]!
    const x = stage.points[gate]!.x
    const [player, rival, clean] = race.vehicles
    if (!player || !rival || !clean) throw new Error('Missing fixture')
    const before = { ...rival, x: x - 2, y: 65, pathIndex: gate }
    const other = { ...clean, x: x - 2, y: 0, pathIndex: gate }
    const human = { ...player, x: x - 30, y: 0, pathIndex: gate - 5 }
    motion.clear()
    motion.set(before.id, { x: x + 2, y: 65 })
    motion.set(other.id, { x: x + 2, y: 0 })
    const missed = stepRace({ ...race, phase: 'running', elapsed: 3, vehicles: [human, before, other] }, input, 1 / 60, random)
    expect(missed.state.missedCheckpoint).toBeUndefined()
    expect(missed.state.vehicles[1]?.missedCheckpoint).toMatchObject({ gate: 1, remainingSeconds: 2 })
    expect(missed.state.vehicles[2]?.nextSector).toBe(2)
    expect(missed.events.some(e => e.type === 'gate-crossed' && e.vehicleId === rival.id)).toBe(false)
    // Back on the road, but already on the wrong side of the stripe.
    motion.set(rival.id, { x: x + 20, y: 0 })
    const pending = missed.state.vehicles[1]!
    const expired = stepRace({ ...missed.state, vehicles: missed.state.vehicles.map(v => v.id === rival.id
      ? { ...pending, x: x + 10, y: 0, missedCheckpoint: { ...pending.missedCheckpoint!, remainingSeconds: 0.01 } } : v) }, input, 1 / 60, random)
    expect(expired.events).toContainEqual(expect.objectContaining({ type: 'vehicle-recovered', reason: 'missed-checkpoint', vehicleId: rival.id }))
    expect(expired.state.vehicles[1]?.pathIndex).toBeLessThan(gate)
    expect(expired.state.vehicles[1]?.nextSector).toBe(1)
    expect(expired.state.vehicles[1]?.missedCheckpoint).toBeUndefined()
    expect(expired.state.vehicles[2]?.nextSector).toBe(2)
    motion.clear()
  })
})
