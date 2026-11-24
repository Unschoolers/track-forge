import { describe, expect, it, vi } from 'vitest'
import { ROAD_GEOMETRY } from '@/domain/config'
import { advanceArcadeTimingGate } from '@/domain/race/arcadeTimingGate'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'

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
  it.each([false, true])('uses identical swept crossing and missed-gate rules for every car (reversed=%s)', reversed => {
    const race = createRace({ path, playerCar: 'yellow', difficulty: 'hard', laps: 2, reversed, recoveryCheckpoints: [0.125, 0.5, 0.875] })
    const gate = race.timingGates![0]!
    const a = path.points[gate]!
    const b = path.points[(gate + 1) % path.points.length]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const tx = (b.x - a.x) / length * (reversed ? -1 : 1)
    const ty = (b.y - a.y) / length * (reversed ? -1 : 1)
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
