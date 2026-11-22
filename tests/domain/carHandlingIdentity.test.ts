import { describe, expect, it } from 'vitest'
import { CAR_SPECS } from '@/domain/config'
import { asTrackId, type CarId } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import type { DriverInput, RaceVehicle } from '@/domain/race/raceState'
import type { VehicleStepContext } from '@/domain/race/trackContext'
import { stepVehicle } from '@/domain/race/vehiclePhysics'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'

const track = createStarterTrack(asTrackId('car-handling-contract'), 1)
const path = buildRoadPath(track.points, track.terrain)
const dt = 1 / 60
type Handling = 'simulation' | 'arcade'
type Surface = 'street' | 'ice' | 'dirt' | 'grass'

function makeVehicle(car: CarId, speed: number, sidewaysSpeed = 0): RaceVehicle {
  const fixture = createRace({
    path,
    playerCar: car,
    difficulty: 'normal',
    laps: 1,
  }).vehicles[0]
  if (!fixture) throw new Error('Missing car handling fixture')
  return {
    ...fixture,
    x: 0,
    y: 0,
    angle: 0,
    vx: speed,
    vy: sidewaysSpeed,
    speed: Math.hypot(speed, sidewaysSpeed),
    yawRate: 0,
    contactLoad: 1,
    currentSurface: 'street',
    surfaceGrip: 1,
  }
}

function context(surface: Surface): VehicleStepContext {
  const point = path.points[0]
  if (!point) throw new Error('Missing path fixture')
  return {
    nearest: { index: 0, point, distance: 0 },
    onRoad: surface !== 'grass',
    onCurb: false,
    surface,
    tangent: { x: 1, y: 0 },
    normal: { x: 0, y: 1 },
    surfaceHeight: 0,
    grade: 0,
    structureRunId: null,
    terrainMaterial: 'grass',
    safeAboveWater: false,
  }
}

function travel(
  initial: RaceVehicle,
  input: DriverInput,
  surface: Surface,
  handling: Handling,
  frames: number,
): RaceVehicle {
  const road = context(surface)
  let vehicle = initial
  for (let frame = 0; frame < frames; frame += 1) {
    vehicle = stepVehicle(vehicle, input, road, dt, handling)
  }
  return vehicle
}

function stoppingDistance(car: CarId, handling: Handling, surface: Surface = 'street'): number {
  let vehicle = makeVehicle(car, 170)
  const road = context(surface)
  const input = { steering: 0, throttle: 0, braking: true }
  for (let frame = 0; frame < 360 && vehicle.speed > 0.5; frame += 1) {
    vehicle = stepVehicle(vehicle, input, road, dt, handling)
  }
  expect(vehicle.speed).toBeLessThan(0.5)
  return vehicle.x
}

/** Same effective front-wheel steering angle, rather than comparing different steering racks. */
function cornering(car: CarId, handling: Handling, surface: Surface = 'street') {
  const steer = 0.65 * CAR_SPECS.blue.steer / CAR_SPECS[car].steer
  let vehicle = makeVehicle(car, 135)
  const road = context(surface)
  let angleSum = 0
  let samples = 0
  for (let frame = 0; frame < 50; frame += 1) {
    vehicle = stepVehicle(
      vehicle,
      { steering: steer, throttle: 0, braking: false },
      road,
      dt,
      handling,
    )
    if (frame >= 10) {
      angleSum += Math.atan2(vehicle.slip, Math.max(1, vehicle.speed))
      samples += 1
    }
  }
  return { slipAngle: angleSum / samples, yawRate: vehicle.yawRate }
}

describe.each(['simulation', 'arcade'] as const)('%s car handling personalities', handling => {
  it('makes Yellow decisively better at street braking than Blue, with Green between them', () => {
    const yellow = stoppingDistance('yellow', handling)
    const green = stoppingDistance('green', handling)
    const blue = stoppingDistance('blue', handling)
    const red = stoppingDistance('red', handling)

    expect(yellow).toBeLessThan(blue * 0.87)
    expect(yellow).toBeLessThan(green)
    expect(green).toBeLessThan(blue)
    expect(blue).toBeLessThan(red)
  })

  it('makes Yellow feel more planted in the same paved corner than balanced Blue', () => {
    const yellow = cornering('yellow', handling)
    const blue = cornering('blue', handling)
    expect(yellow.slipAngle).toBeLessThan(blue.slipAngle * 0.9)
    expect(yellow.yawRate).toBeGreaterThan(0.2)
  })

  it('gives Green stronger corner grip and steering response than Blue', () => {
    const green = cornering('green', handling)
    const blue = cornering('blue', handling)
    expect(green.slipAngle).toBeLessThan(blue.slipAngle * 0.95)
    expect(green.yawRate).toBeGreaterThan(blue.yawRate * 1.05)
  })

  it('keeps Red more demanding on pavement than balanced Blue', () => {
    const red = cornering('red', handling)
    const blue = cornering('blue', handling)
    expect(red.slipAngle).toBeGreaterThan(blue.slipAngle)
  })

  it('makes street tires settle a sideways skid substantially better than ice', () => {
    const initial = makeVehicle('blue', 155, 32)
    const input = { steering: 0, throttle: 0, braking: false }
    const street = travel(initial, input, 'street', handling, 18)
    const ice = travel(initial, input, 'ice', handling, 18)
    expect(street.slip).toBeLessThan(ice.slip * 0.75)
  })

  it('preserves Yellow\'s braking advantage through dirt, not just pavement', () => {
    expect(stoppingDistance('yellow', handling, 'dirt')).toBeLessThan(
      stoppingDistance('blue', handling, 'dirt') * 0.9,
    )
  })
})
