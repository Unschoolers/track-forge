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
