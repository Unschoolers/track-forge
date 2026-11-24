import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAR_SPECS, OFFROAD_SURFACE, SURFACE_SPECS, VEHICLE_TERRAIN_SPECS } from '@/domain/config'
import type { CarId } from '@/domain/model'
import { physicsPlayer } from '../support/physicsPlayer'
import type { DriverInput, RaceVehicle } from '@/domain/race/raceState'
import type { VehicleStepContext } from '@/domain/race/trackContext'
import { stepVehicle } from '@/domain/race/vehiclePhysics'
import { VEHICLE_DYNAMICS_TUNING } from '@/domain/race/vehiclePhysicsConfig'
import { decodeTrack } from '@/domain/track/trackCodec'
import { buildRoadPath } from '@/domain/track/pathBuilder'

// A creator-authored seven-point handling course. The original geometry and
// street -> ice -> dirt -> street sequence are retained without player metadata.
const exported: unknown = JSON.parse(readFileSync('tests/fixtures/turnTest.trackforge.json', 'utf8'))
if (!exported || typeof exported !== 'object' || !('track' in exported)) {
  throw new Error('Turn test must be a Track Forge export')
}
const track = decodeTrack(exported.track, 1)
if (!track) throw new Error('Invalid Turn test track fixture')
const path = buildRoadPath(track.points, track.terrain, Infinity, track.routeKind)
const dt = 1 / 60
type Handling = 'simulation' | 'arcade'
type Surface = 'street' | 'ice' | 'dirt' | 'grass'

function context(surface: Surface): VehicleStepContext {
  const index = path.points.findIndex(point => point.surface === (surface === 'grass' ? 'street' : surface))
  const point = path.points[index]
  if (!point) throw new Error(`Turn test has no ${surface} section`)
  const ahead = path.points[index + 1] ?? path.points[index - 1]
  if (!ahead) throw new Error('Missing test-track direction')
  const length = Math.max(0.001, Math.hypot(ahead.x - point.x, ahead.y - point.y))
  const tangent = { x: (ahead.x - point.x) / length, y: (ahead.y - point.y) / length }
  return {
    nearest: { index, point, distance: 0 },
    onRoad: surface !== 'grass',
    onCurb: false,
    surface,
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
    surfaceHeight: 0,
    grade: 0,
    structureRunId: null,
    terrainMaterial: 'grass',
    safeAboveWater: false,
  }
}

function makeVehicle(car: CarId, speed: number, sidewaysSpeed = 0, surface: Surface = 'street'): RaceVehicle {
  const fixture = physicsPlayer(car)
  const road = context(surface)
  const angle = Math.atan2(road.tangent.y, road.tangent.x)
  return {
    ...fixture,
    x: road.nearest.point.x,
    y: road.nearest.point.y,
    angle,
    vx: road.tangent.x * speed - road.tangent.y * sidewaysSpeed,
    vy: road.tangent.y * speed + road.tangent.x * sidewaysSpeed,
    speed: Math.hypot(speed, sidewaysSpeed),
    yawRate: 0,
    contactLoad: 1,
    currentSurface: surface,
    surfaceGrip: 1,
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
  let vehicle = makeVehicle(car, 170, 0, surface)
  const road = context(surface)
  const heading = road.tangent
  const start = { x: vehicle.x, y: vehicle.y }
  const input = { steering: 0, throttle: 0, braking: true }
  for (let frame = 0; frame < 360 && vehicle.speed > 0.5; frame += 1) {
    vehicle = stepVehicle(vehicle, input, road, dt, handling)
  }
  expect(vehicle.speed).toBeLessThan(0.5)
  return (vehicle.x - start.x) * heading.x + (vehicle.y - start.y) * heading.y
}

/** Identical effective wheel angle: compare handling rather than steering-rack gearing. */
function cornering(car: CarId, handling: Handling, speed = 135, matchedWheelAngle = true) {
  const road = context('street')
  const steer = matchedWheelAngle
    ? 0.65 * CAR_SPECS.blue.steer / CAR_SPECS[car].steer
    : 0.65
  let vehicle = makeVehicle(car, speed)
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
  return { slipAngle: angleSum / samples, yawRate: Math.abs(vehicle.yawRate) }
}

describe('creator Turn test fixture', () => {
  it('retains distinct paved, ice, and dirt driving sections', () => {
    expect(new Set(track.points.map(point => point.surface)))
      .toEqual(new Set(['street', 'ice', 'dirt']))
    expect(path.points.length).toBeGreaterThan(track.points.length)
  })
})

describe.each(['simulation', 'arcade'] as const)('%s car handling personalities', handling => {
  it('makes Yellow stop shortest on road, with meaningful advantages over Green and Blue', () => {
    const yellow = stoppingDistance('yellow', handling)
    const green = stoppingDistance('green', handling)
    const blue = stoppingDistance('blue', handling)
    expect(yellow).toBeLessThan(blue * 0.87)
    expect(yellow).toBeLessThan(green)
    expect(green).toBeLessThan(blue * 0.94)
  })

  it('gives Red the strongest pavement brakes while Yellow stays the all-terrain braking specialist', () => {
    const red = stoppingDistance('red', handling)
    expect(red).toBeLessThan(stoppingDistance('blue', handling) * 0.97)
    expect(red).toBeLessThan(stoppingDistance('yellow', handling) * 0.85)
  })

  it('makes Yellow feel more planted than balanced Blue in the same paved corner', () => {
    const yellow = cornering('yellow', handling)
    const blue = cornering('blue', handling)
    expect(yellow.slipAngle).toBeLessThan(blue.slipAngle * 0.9)
    expect(yellow.yawRate).toBeGreaterThan(0.2)
  })

  it('gives Green less body slip at the same wheel angle than Blue', () => {
    const green = cornering('green', handling)
    const blue = cornering('blue', handling)
    expect(green.slipAngle).toBeLessThan(blue.slipAngle * 0.95)
  })

  it('makes Green turn faster than Blue for the same player steering input', () => {
    const green = cornering('green', handling, 135, false)
    const blue = cornering('blue', handling, 135, false)
    expect(green.yawRate).toBeGreaterThan(blue.yawRate * 1.05)
  })

  it('makes Red slide more than Blue in fast paved corners despite better braking', () => {
    const red = cornering('red', handling, 210)
    const blue = cornering('blue', handling, 210)
    expect(red.slipAngle).toBeGreaterThan(blue.slipAngle * 1.2)
  })

  it('keeps Red weaker than Blue on dirt without the old excessive braking penalty', () => {
    // Dirt grip remains Red's weakness, while its brakes have a usable range.
    expect(VEHICLE_TERRAIN_SPECS.red.dirt.grip).toBeLessThan(VEHICLE_TERRAIN_SPECS.blue.dirt.grip)
    expect(VEHICLE_TERRAIN_SPECS.red.street).toEqual(VEHICLE_TERRAIN_SPECS.blue.street)
    const red = stoppingDistance('red', handling, 'dirt')
    const blue = stoppingDistance('blue', handling, 'dirt')
    const green = stoppingDistance('green', handling, 'dirt')
    // Compare player-visible distance, not an exact internal tuning value:
    // Red stays meaningfully worse than Blue, but the old >20% gap is gone.
    const redToBlue = red / blue
    expect(redToBlue, `${handling}: Red=${red.toFixed(1)}, Blue=${blue.toFixed(1)}`).toBeGreaterThan(1.08)
    expect(redToBlue, `${handling}: Red=${red.toFixed(1)}, Blue=${blue.toFixed(1)}`).toBeLessThan(1.2)
    expect(green).toBeLessThan(blue)
  })

  it('makes the same corner less slippery on street than ice for every car', () => {
    for (const car of ['blue', 'red', 'green', 'yellow'] as const) {
      const initial = makeVehicle(car, 155, 32, 'street')
      const iceInitial = makeVehicle(car, 155, 32, 'ice')
      const input = { steering: 0, throttle: 0, braking: false }
      const street = travel(initial, input, 'street', handling, 18)
      const ice = travel(iceInitial, input, 'ice', handling, 18)
      expect(street.slip, `${car} street vs ice`).toBeLessThan(ice.slip * 0.75)
    }
  })

  it('gives Yellow the shortest stopping distance on dirt and grass', () => {
    for (const surface of ['dirt', 'grass'] as const) {
      const yellow = stoppingDistance('yellow', handling, surface)
      for (const rival of ['blue', 'green', 'red'] as const) {
        expect(yellow, `${surface}/${rival}`).toBeLessThan(stoppingDistance(rival, handling, surface))
      }
      expect(yellow).toBeLessThan(stoppingDistance('blue', handling, surface) * 0.9)
    }
  })

  it('matches the four ice braking distance targets from 170 units/s', () => {
    const targets = { red: 250, blue: 235, green: 200, yellow: 150 } as const
    for (const car of ['red', 'blue', 'green', 'yellow'] as const) {
      const distance = stoppingDistance(car, handling, 'ice')
      expect(Math.abs(distance - targets[car]), car).toBeLessThan(1)
    }
  })

  it('scales Red service brakes on pavement and ice only', () => {
    for (const surface of ['street', 'dirt', 'grass', 'ice'] as const) {
      const spec = surface === 'grass' ? OFFROAD_SURFACE : SURFACE_SPECS[surface]
      const terrain = VEHICLE_TERRAIN_SPECS.red[surface]
      const initial = { ...makeVehicle('red', 170, 0, surface),
        brakePressure: 1, surfaceGrip: spec.grip * terrain.grip }
      const road = context(surface)
      const coast = stepVehicle({ ...initial, brakePressure: 0 },
        { steering: 0, throttle: 0, braking: false }, road, dt, handling)
      const brake = stepVehicle(initial,
        { steering: 0, throttle: 0, braking: true }, road, dt, handling)
      const car = CAR_SPECS.red
      const forces = VEHICLE_DYNAMICS_TUNING.forces
      // Freeze the pre-upgrade service-brake scale, not the new multiplier.
      const oldBrakeForce = Math.min(
        car.brakeForce / car.mass * car.brake * spec.brake * terrain.brake,
        forces.gravityAcceleration * car.grip * initial.surfaceGrip * forces.brakeGripUsage,
      ) * forces.brakingTractionScale * 1.38
      expect((coast.speed - brake.speed) / dt / oldBrakeForce, surface)
        .toBeCloseTo(surface === 'street' ? 1.5 : surface === 'ice' ? 1.9877 : 1, 8)
    }
  })
})
