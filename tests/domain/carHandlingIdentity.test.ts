import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CAR_SPECS, OFFROAD_SURFACE, SURFACE_SPECS, VEHICLE_TERRAIN_SPECS } from '@/domain/config'
import type { CarId } from '@/domain/model'
import { physicsPlayer } from '../support/physicsPlayer'
import type { DriverInput, RaceVehicle } from '@/domain/race/raceState'
import type { VehicleStepContext } from '@/domain/race/trackContext'
import { stepVehicle } from '@/domain/race/vehiclePhysics'
import { steeringLimitAtSpeed, VEHICLE_DYNAMICS_TUNING, type CarPhysicsSpec } from '@/domain/race/vehiclePhysicsConfig'
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
  frames: number,
): RaceVehicle {
  const road = context(surface)
  let vehicle = initial
  for (let frame = 0; frame < frames; frame += 1) {
    vehicle = stepVehicle(vehicle, input, road, dt)
  }
  return vehicle
}

function stoppingDistance(car: CarId, surface: Surface = 'street'): number {
  let vehicle = makeVehicle(car, 170, 0, surface)
  const road = context(surface)
  const heading = road.tangent
  const start = { x: vehicle.x, y: vehicle.y }
  const input = { steering: 0, throttle: 0, braking: true }
  for (let frame = 0; frame < 360 && vehicle.speed > 0.5; frame += 1) {
    vehicle = stepVehicle(vehicle, input, road, dt)
  }
  expect(vehicle.speed).toBeLessThan(0.5)
  return (vehicle.x - start.x) * heading.x + (vehicle.y - start.y) * heading.y
}

/** Identical effective wheel angle: compare handling rather than steering-rack gearing. */
function cornering(car: CarId, speed = 135, matchedWheelAngle = true) {
  const road = context('street')
  const steeringLimit = (spec: CarPhysicsSpec) => steeringLimitAtSpeed(
    spec.steer * VEHICLE_DYNAMICS_TUNING.steering.maximumAngleScale,
    speed / spec.max,
    VEHICLE_DYNAMICS_TUNING.steering.highSpeedReduction,
    spec.lowSpeedSteerAngle,
  )
  const steer = matchedWheelAngle
    ? 0.65 * steeringLimit(CAR_SPECS.blue) / steeringLimit(CAR_SPECS[car])
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

describe('Car handling personalities', () => {
  it('makes Yellow stop shortest on road, with meaningful advantages over Green and Blue', () => {
    const yellow = stoppingDistance('yellow')
    const green = stoppingDistance('green')
    const blue = stoppingDistance('blue')
    expect(yellow).toBeLessThan(blue * 0.87)
    expect(yellow).toBeLessThan(green)
    expect(green).toBeLessThan(blue * 0.94)
  })

  it('gives Red the strongest pavement brakes while Yellow stays the all-terrain braking specialist', () => {
    const red = stoppingDistance('red')
    expect(red).toBeLessThan(stoppingDistance('blue') * 0.97)
    expect(red).toBeLessThan(stoppingDistance('yellow') * 0.85)
  })

  it('makes Yellow feel more planted than balanced Blue in the same paved corner', () => {
    const yellow = cornering('yellow')
    const blue = cornering('blue')
    expect(yellow.slipAngle).toBeLessThan(blue.slipAngle * 0.9)
    expect(yellow.yawRate).toBeGreaterThan(0.2)
  })

  it('gives Green less body slip at the same wheel angle than Blue', () => {
    const green = cornering('green')
    const blue = cornering('blue')
    expect(green.slipAngle).toBeLessThan(blue.slipAngle * 0.95)
  })

  it('makes Green turn faster than Blue for the same player steering input', () => {
    const green = cornering('green', 135, false)
    const blue = cornering('blue', 135, false)
    expect(green.yawRate).toBeGreaterThan(blue.yawRate * 1.05)
  })

  it('makes Red slide more than Blue in fast paved corners despite better braking', () => {
    const red = cornering('red', 210)
    const blue = cornering('blue', 210)
    expect(red.slipAngle).toBeGreaterThan(blue.slipAngle * 1.2)
  })

  it('keeps Red weaker than Blue on dirt without the old excessive braking penalty', () => {
    // Dirt grip remains Red's weakness, while its brakes have a usable range.
    expect(VEHICLE_TERRAIN_SPECS.red.dirt.grip).toBeLessThan(VEHICLE_TERRAIN_SPECS.blue.dirt.grip)
    expect(VEHICLE_TERRAIN_SPECS.red.street).toEqual(VEHICLE_TERRAIN_SPECS.blue.street)
    const red = stoppingDistance('red', 'dirt')
    const blue = stoppingDistance('blue', 'dirt')
    const green = stoppingDistance('green', 'dirt')
    // Compare player-visible distance, not an exact internal tuning value:
    // Red stays meaningfully worse than Blue, but the old >20% gap is gone.
    const redToBlue = red / blue
    expect(redToBlue, `Red=${red.toFixed(1)}, Blue=${blue.toFixed(1)}`).toBeGreaterThan(1.08)
    expect(redToBlue, `Red=${red.toFixed(1)}, Blue=${blue.toFixed(1)}`).toBeLessThan(1.2)
    expect(green).toBeLessThan(blue)
  })

  it('makes the same corner less slippery on street than ice for every car', () => {
    for (const car of ['blue', 'red', 'green', 'yellow'] as const) {
      const initial = makeVehicle(car, 155, 32, 'street')
      const iceInitial = makeVehicle(car, 155, 32, 'ice')
      const input = { steering: 0, throttle: 0, braking: false }
      const street = travel(initial, input, 'street', 18)
      const ice = travel(iceInitial, input, 'ice', 18)
      expect(street.slip, `${car} street vs ice`).toBeLessThan(ice.slip * 0.75)
    }
  })

  it('gives Yellow the shortest stopping distance on dirt and grass', () => {
    for (const surface of ['dirt', 'grass'] as const) {
      const yellow = stoppingDistance('yellow', surface)
      for (const rival of ['blue', 'green', 'red'] as const) {
        expect(yellow, `${surface}/${rival}`).toBeLessThan(stoppingDistance(rival, surface))
      }
      expect(yellow).toBeLessThan(stoppingDistance('blue', surface) * 0.9)
    }
  })

  it('lets Red change its actual travel direction on ice even while braking', () => {
    const road = context('ice')
    const terrain = VEHICLE_TERRAIN_SPECS.red.ice
    for (const steering of [-1, 1]) {
      const initial = {
        ...makeVehicle('red', 110, 0, 'ice'),
        surfaceGrip: SURFACE_SPECS.ice.grip * terrain.grip,
      }
      for (const braking of [false, true]) {
        const result = travel(initial, { steering, throttle: 0, braking }, 'ice', 60)
        const forward = result.vx * road.tangent.x + result.vy * road.tangent.y
        const sideways = result.vx * road.normal.x + result.vy * road.normal.y
        const travelAngle = Math.atan2(sideways, forward) * steering
        expect(travelAngle, `steering=${steering}, braking=${braking}`)
          .toBeGreaterThan(braking ? 0.35 : 0.55)
      }
    }
  })

  it('lets Red change its path while crawling under full braking on ice', () => {
    const road = context('ice')
    for (const speed of [10, 20]) {
      for (const steering of [-1, 1]) {
        const initial = {
          ...makeVehicle('red', speed, 0, 'ice'),
          brakePressure: 1,
          surfaceGrip: SURFACE_SPECS.ice.grip * VEHICLE_TERRAIN_SPECS.red.ice.grip,
        }
        const result = travel(initial, { steering, throttle: 0, braking: true }, 'ice', 30)
        const dx = result.x - initial.x
        const dy = result.y - initial.y
        const forward = dx * road.tangent.x + dy * road.tangent.y
        const sideways = dx * road.normal.x + dy * road.normal.y
        // Measure the actual trajectory, not body rotation or wheel angle.
        expect(Math.atan2(sideways, forward) * steering).toBeGreaterThan(0.3)
        expect(result.speed).toBeLessThan(2)
      }
    }
  })

  it('meets the full-brake trajectory angle targets on all three roads', () => {
    const cars = ['red', 'blue', 'green', 'yellow'] as const
    const caps = { street: 45, dirt: 40, ice: 35 } as const
    const truckCaps = { street: 50, dirt: 45, ice: 40 } as const
    for (const surface of ['street', 'dirt', 'ice'] as const) {
      const road = context(surface)
      for (const car of cars) {
        for (let speed = 5; speed <= 100; speed += 1) {
          const initial = {
            ...makeVehicle(car, speed, 0, surface),
            brakePressure: 1,
            surfaceGrip: SURFACE_SPECS[surface].grip * VEHICLE_TERRAIN_SPECS[car][surface].grip,
          }
          const cap = car === 'yellow' ? truckCaps[surface] : caps[surface]
          for (const steering of [-1, 1]) {
            const result = travel(initial, { steering, throttle: 0, braking: true }, surface, 30)
            const dx = result.x - initial.x
            const dy = result.y - initial.y
            const forward = dx * road.tangent.x + dy * road.tangent.y
            const sideways = dx * road.normal.x + dy * road.normal.y
            const angle = Math.atan2(sideways, forward) * steering * 180 / Math.PI
            const label = `${car}/${surface}/${speed}/${steering}`
            expect(angle, label).toBeGreaterThan(0)
            expect(angle, label).toBeLessThanOrEqual(cap)
            if (car === 'yellow' && speed >= 45) expect(angle, label).toBeGreaterThanOrEqual(20)
          }
        }
      }
    }
  })

  it('matches the four ice braking distance targets from 170 units/s', () => {
    const targets = { red: 250, blue: 235, green: 200, yellow: 150 } as const
    for (const car of ['red', 'blue', 'green', 'yellow'] as const) {
      const distance = stoppingDistance(car, 'ice')
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
        { steering: 0, throttle: 0, braking: false }, road, dt)
      const brake = stepVehicle(initial,
        { steering: 0, throttle: 0, braking: true }, road, dt)
      const car = CAR_SPECS.red
      const forces = VEHICLE_DYNAMICS_TUNING.forces
      // Freeze the pre-upgrade service-brake scale, not the new multiplier.
      const oldBrakeForce = Math.min(
        car.brakeForce / car.mass * car.brake * spec.brake * terrain.brake,
        forces.gravityAcceleration * car.grip * initial.surfaceGrip * forces.brakeGripUsage,
      ) * forces.brakingTractionScale * 1.38
      expect((coast.speed - brake.speed) / dt / oldBrakeForce, surface)
        .toBeCloseTo(surface === 'street' ? 1.5 : surface === 'ice' ? 1.5268 : 1, 8)
    }
  })
})
