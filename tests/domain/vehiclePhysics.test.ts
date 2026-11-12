import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import {
  getVehicleStepContext,
  resetVehicleToTrack,
} from '@/domain/race/trackContext'
import { stepVehicle } from '@/domain/race/vehiclePhysics'

const track = createStarterTrack(asTrackId('physics'), 1)
const path = buildRoadPath(track.points, track.terrain)

function vehicle(car: 'red' | 'green' | 'yellow' = 'red') {
  const value = createRace({
    path,
    playerCar: car,
    difficulty: 'normal',
    laps: 3,
  }).vehicles[0]
  if (!value) throw new Error('Missing player fixture')
  return value
}

describe('vehicle physics', () => {
  it('carries street momentum onto grass before settling at a lower speed', () => {
    const base = {
      ...vehicle(),
      x: 10_000,
      y: 10_000,
      angle: 0,
      vx: 280,
      speed: 280,
      currentSurface: 'street' as const,
    }
    const grass = getVehicleStepContext(path, base)
    expect(grass.surface).toBe('grass')
    const input = { steering: 0, throttle: 1, braking: false }
    const first = stepVehicle(base, input, grass, 1 / 60)
    expect(first.speed).toBeGreaterThanOrEqual(252)

    let running = first
    for (let frame = 1; frame < 120; frame++) {
      running = stepVehicle(running, input, grass, 1 / 60)
    }
    expect(running.speed).toBeLessThan(first.speed * 0.85)
    for (let frame = 120; frame < 1200; frame++) {
      running = stepVehicle(running, input, grass, 1 / 60)
    }
    expect(running.speed).toBeGreaterThan(25)
    expect(running.speed).toBeLessThan(140)
    const next = stepVehicle(running, input, grass, 1 / 60)
    expect(next.speed).toBeCloseTo(running.speed, 1)
  })

  it('eases the loss of lateral grip when entering ice', () => {
    const base = { ...vehicle(), angle: 0, vx: 100, vy: 45, speed: 110 }
    const street = { ...getVehicleStepContext(path, base), grade: 0, surface: 'street' as const }
    const ice = { ...street, surface: 'ice' as const }
    const input = { steering: 0, throttle: 0, braking: false }
    const roadStep = stepVehicle(base, input, street, 1 / 60)
    const enteringIce = stepVehicle(base, input, ice, 1 / 60)
    const settledIce = stepVehicle({ ...base, currentSurface: 'ice' }, input, ice, 1 / 60)

    expect(enteringIce.slip).toBeGreaterThan(roadStep.slip)
    expect(enteringIce.slip).toBeLessThan(settledIce.slip)
  })

  it('applies car-specific grass performance and surface grip', () => {
    const farFromRoad = { ...vehicle(), x: 10_000, y: 10_000 }
    const grass = getVehicleStepContext(path, farFromRoad)
    const red = stepVehicle(
      farFromRoad,
      { steering: 0, throttle: 1, braking: false },
      grass,
      0.5,
    )
    const yellowBase = { ...vehicle('yellow'), x: 10_000, y: 10_000 }
    const yellow = stepVehicle(
      yellowBase,
      { steering: 0, throttle: 1, braking: false },
      getVehicleStepContext(path, yellowBase),
      0.5,
    )

    expect(grass.surface).toBe('grass')
    expect(yellow.speed).toBeGreaterThan(red.speed * 1.8)

    const streetBase = { ...vehicle('green'), vx: 80, vy: 60, speed: 100 }
    const street = stepVehicle(
      streetBase,
      { steering: 0, throttle: 0, braking: false },
      { ...getVehicleStepContext(path, streetBase), surface: 'street' },
      0.1,
    )
    const ice = stepVehicle(
      streetBase,
      { steering: 0, throttle: 0, braking: false },
      { ...getVehicleStepContext(path, streetBase), surface: 'ice' },
      0.1,
    )
    expect(ice.slip).toBeGreaterThan(street.slip)
  })

  it('brakes, stops wrecked vehicles, and detects eligible curbs', () => {
    const fixture = vehicle()
    const base = {
      ...fixture,
      vx: Math.cos(fixture.angle) * 120,
      vy: Math.sin(fixture.angle) * 120,
      speed: 120,
    }
    const context = getVehicleStepContext(path, base)
    const coasting = stepVehicle(
      base,
      { steering: 0, throttle: 0, braking: false },
      context,
      0.1,
    )
    const braking = stepVehicle(
      base,
      { steering: 0, throttle: 1, braking: true },
      context,
      0.1,
    )
    expect(braking.speed).toBeLessThan(coasting.speed)

    const stopped = stepVehicle(
      { ...base, wrecked: true },
      { steering: 1, throttle: 1, braking: false },
      context,
      0.1,
    )
    expect(stopped).toMatchObject({ speed: 0, vx: 0, vy: 0 })

    const curb = path.points.some((point, index) => {
      const ahead = path.points[(index + 3) % path.points.length]
      if (!ahead || point.surface !== 'street') return false
      const length = Math.hypot(ahead.x - point.x, ahead.y - point.y)
      const candidate = {
        ...base,
        x: point.x - ((ahead.y - point.y) / length) * 36,
        y: point.y + ((ahead.x - point.x) / length) * 36,
        pathIndex: index,
      }
      return getVehicleStepContext(path, candidate).onCurb
    })
    expect(curb).toBe(true)
  })

  it('offers an arcade handling profile without replacing simulation physics', () => {
    const fixture = vehicle()
    const initial = { ...fixture, vx: Math.cos(fixture.angle) * 130, vy: Math.sin(fixture.angle) * 130, speed: 130 }
    const context = getVehicleStepContext(path, initial)
    const input = { steering: 0.85, throttle: 1, braking: false }
    const simulation = stepVehicle(initial, input, context, 1 / 60, 'simulation')
    const arcade = stepVehicle(initial, input, context, 1 / 60, 'arcade')
    expect(arcade).not.toEqual(simulation)
    expect(Number.isFinite(arcade.angle)).toBe(true)
    expect(arcade.speed).toBeGreaterThan(0)
  })

  it('trims speed on the first Arcade brake frame instead of applying full force', () => {
    const initial = { ...vehicle(), angle: 0, vx: 180, vy: 0, speed: 180 }
    const context = { ...getVehicleStepContext(path, initial), surface: 'street' as const, grade: 0 }
    const coast = { steering: 0.7, throttle: 0, braking: false }
    const brake = { ...coast, throttle: 1, braking: true }
    const dt = 1 / 60
    const coasting = stepVehicle(initial, coast, context, dt, 'arcade')
    const tapping = stepVehicle(initial, brake, context, dt, 'arcade')
    const full = stepVehicle({ ...initial, brakePressure: 1 }, brake, context, dt, 'arcade')

    expect(tapping.speed).toBeLessThan(coasting.speed)
    expect(coasting.speed - tapping.speed).toBeLessThan((coasting.speed - full.speed) * 0.4)
    expect(Math.abs(tapping.yawRate)).toBeGreaterThan(Math.abs(full.yawRate))
  })

  it('holds full braking to stop and restores acceleration after release', () => {
    let car = { ...vehicle(), angle: 0, vx: 180, vy: 0, speed: 180 }
    const context = { ...getVehicleStepContext(path, car), surface: 'street' as const, grade: 0 }
    const dt = 1 / 60
    for (let step = 0; step < 240; step += 1) {
      car = stepVehicle(car, { steering: 0, throttle: 1, braking: true }, context, dt, 'arcade')
    }
    expect(car.speed).toBeLessThan(0.5)
    const released = stepVehicle(car, { steering: 0, throttle: 1, braking: false }, context, dt, 'arcade')
    expect(released.speed).toBeLessThan(1)
    car = released
    for (let step = 0; step < 30; step += 1) {
      car = stepVehicle(car, { steering: 0, throttle: 1, braking: false }, context, dt, 'arcade')
    }
    expect(car.speed).toBeGreaterThan(40)
  })

  it('resets a stuck player to the nearest road heading', () => {
    const base = {
      ...vehicle(),
      x: 10_000,
      y: 10_000,
      vx: 5,
      vy: 4,
      speed: 7,
      slip: 20,
      stuckDuration: 2,
      z: 8,
      verticalVelocity: -12,
      grounded: false,
      suspensionCompression: -0.5,
      landingIntensity: 0.8,
      contactLoad: 0,
    }
    const reset = resetVehicleToTrack(base, path)

    expect(reset.speed).toBe(0)
    expect(reset.stuckDuration).toBe(0)
    expect(reset.verticalVelocity).toBe(0)
    expect(reset.grounded).toBe(true)
    expect(reset.contactLoad).toBe(1)
    expect(reset.z).toBeCloseTo(
      getVehicleStepContext(path, reset).surfaceHeight,
    )
    expect(getVehicleStepContext(path, reset).onRoad).toBe(true)
    expect(reset.angle).not.toBe(base.angle)
  })
})
