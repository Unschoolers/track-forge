import { describe, expect, it } from 'vitest'
import { CAR_IDS, asTrackId, type CarId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { stepPlayer, stepVehicle } from '@/domain/race/vehiclePhysics'
import { VEHICLE_TERRAIN_PHYSICS_SPECS } from '@/domain/race/vehiclePhysicsConfig'
import type { VehicleStepContext } from '@/domain/race/trackContext'

const track = createStarterTrack(asTrackId('balance'), 1)
const path = buildRoadPath(track.points, track.terrain)

function stoppingDistance(car: CarId): number {
  const vehicle = createRace({ path, playerCar: car, difficulty: 'normal', laps: 1 }).vehicles[0]
  if (!vehicle) throw new Error('Missing player')
  let state = { ...vehicle, x: 0, y: 0, angle: 0, vx: 180, vy: 0, speed: 180 }
  for (let i = 0; i < 600 && state.speed > 0.5; i++) {
    state = stepPlayer(state, { steering: 0, throttle: 0, braking: true }, 'street', 1 / 60)
  }
  return state.x
}

describe('car roles', () => {
  it('lets the braking specialist stop shortest from the same street speed', () => {
    const distances = Object.fromEntries(CAR_IDS.map(car => [car, stoppingDistance(car)])) as Record<CarId, number>
    expect(distances.yellow).toBeLessThan(Math.min(distances.blue, distances.red, distances.green))
  })
})

function straightLineSpeed(car: CarId, seconds: number): number {
  const start = createRace({ path, playerCar: car, difficulty: 'normal', laps: 1 }).vehicles[0]
  if (!start) throw new Error('Missing player')
  let vehicle = { ...start, x: 0, y: 0, angle: 0, vx: 0, vy: 0, speed: 0 }
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
    vehicle = stepPlayer(vehicle, { steering: 0, throttle: 1, braking: false }, 'street', 1 / 60)
  }
  return vehicle.speed
}

describe('speed ratings', () => {
  it('gives the red pavement specialist a meaningful straight-line advantage over blue', () => {
    expect(straightLineSpeed('red', 2)).toBeGreaterThan(straightLineSpeed('blue', 2) * 1.05)
    expect(straightLineSpeed('red', 8)).toBeGreaterThan(straightLineSpeed('blue', 8) * 1.08)
  })
})

describe('Red grass handling', () => {
  const grass: VehicleStepContext = {
    nearest: { index: 0, point: path.points[0]!, distance: 90 },
    onRoad: false, onCurb: false, surface: 'grass',
    tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 },
    surfaceHeight: 0, grade: 0, structureRunId: null,
    terrainMaterial: 'grass', safeAboveWater: false,
  }

  function leavingRoad(car: CarId, handling: 'arcade' | 'simulation'): number {
    const base = createRace({ path, playerCar: car, difficulty: 'normal', laps: 1 }).vehicles[0]
    if (!base) throw new Error('Missing player')
    let vehicle = {
      ...base, angle: 0, vx: 170, vy: 0, speed: 170,
      currentSurface: 'street' as const, surfaceGrip: 1,
    }
    for (let frame = 0; frame < 120; frame++) {
      vehicle = stepVehicle(vehicle, { steering: 0, throttle: 1, braking: false },
        grass, 1 / 60, handling)
    }
    return vehicle.speed
  }

  it('makes the street specialist markedly slower after entering grass than Blue or Yellow', () => {
    for (const handling of ['arcade', 'simulation'] as const) {
      const red = leavingRoad('red', handling)
      const blue = leavingRoad('blue', handling)
      const yellow = leavingRoad('yellow', handling)
      expect(red).toBeLessThan(blue * 0.9)
      expect(red).toBeLessThan(yellow * 0.8)
    }
  })

  it('changes only Red grass modifiers, preserving street speed and rival specialties', () => {
    const grassPenalty = VEHICLE_TERRAIN_PHYSICS_SPECS.red.grass
    expect(grassPenalty.max).toBeCloseTo(0.51)
    expect(grassPenalty.accel).toBeCloseTo(0.4)
    expect(grassPenalty.grip).toBeCloseTo(0.57)
    expect(grassPenalty.drag).toBeCloseTo(2.35)
    expect(VEHICLE_TERRAIN_PHYSICS_SPECS.red.street)
      .toEqual(VEHICLE_TERRAIN_PHYSICS_SPECS.blue.street)
    expect(VEHICLE_TERRAIN_PHYSICS_SPECS.yellow.grass.max)
      .toBeGreaterThan(VEHICLE_TERRAIN_PHYSICS_SPECS.green.grass.max)
  })
})
