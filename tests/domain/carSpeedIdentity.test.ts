import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CarId } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import type { RaceVehicle } from '@/domain/race/raceState'
import { stepVehicle } from '@/domain/race/vehiclePhysics'
import { decodeTrack } from '@/domain/track/trackCodec'
import { buildRoadPath } from '@/domain/track/pathBuilder'

const exported: unknown = JSON.parse(readFileSync('tests/fixtures/speed.trackforge.json', 'utf8'))
if (!exported || typeof exported !== 'object' || !('track' in exported)) {
  throw new Error('Speed fixture must be a Track Forge export')
}
const track = decodeTrack(exported.track, 1)
if (!track) throw new Error('Invalid Speed track fixture')
const path = buildRoadPath(track.points, track.terrain, Infinity, track.routeKind)
const start = path.points[0]
const finish = path.points.at(-1)
if (!start || !finish) throw new Error('Speed straightaway is missing an endpoint')
const length = Math.hypot(finish.x - start.x, finish.y - start.y)
const direction = {
  x: (finish.x - start.x) / length,
  y: (finish.y - start.y) / length,
}
const dt = 1 / 60
type Surface = 'street' | 'dirt'

function drive(
  car: CarId,
  surface: Surface,
  handling: 'arcade' | 'simulation',
  seconds: number,
): { readonly vehicle: RaceVehicle; readonly distance: number } {
  const fixture = createRace({
    path,
    playerCar: car,
    difficulty: 'normal',
    laps: 1,
  }).vehicles[0]
  if (!fixture) throw new Error('Missing player on Speed track')
  let vehicle: RaceVehicle = {
    ...fixture,
    x: start!.x,
    y: start!.y,
    angle: Math.atan2(direction.y, direction.x),
    vx: 0,
    vy: 0,
    speed: 0,
    currentSurface: surface,
    contactLoad: 1,
    surfaceGrip: 1,
  }
  const context = {
    nearest: { index: 0, point: start!, distance: 0 },
    onRoad: true,
    onCurb: false,
    surface,
    tangent: direction,
    normal: { x: -direction.y, y: direction.x },
    surfaceHeight: 0,
    grade: 0,
    structureRunId: null,
    terrainMaterial: 'grass' as const,
    safeAboveWater: false,
  }
  for (let frame = 0; frame < Math.round(seconds / dt); frame += 1) {
    vehicle = stepVehicle(
      vehicle,
      { steering: 0, throttle: 1, braking: false },
      context,
      dt,
      handling,
    )
  }
  return {
    vehicle,
    distance: (vehicle.x - start.x) * direction.x +
      (vehicle.y - start.y) * direction.y,
  }
}

describe('creator Speed fixture', () => {
  it('preserves a long, nearly straight road with street-to-dirt endpoints', () => {
    expect(track.points.map(point => point.surface)).toEqual(['street', 'dirt'])
    expect(path.closed).toBe(false)
    expect(length).toBeGreaterThan(1200)
    expect(Math.abs(direction.x)).toBeLessThan(0.01)
  })
})

describe.each(['arcade', 'simulation'] as const)('%s speed specialties on the Speed track', handling => {
  it('makes Red clearly fastest on a long paved straight, followed by Blue', () => {
    const red = drive('red', 'street', handling, 8)
    const blue = drive('blue', 'street', handling, 8)
    const green = drive('green', 'street', handling, 8)
    const yellow = drive('yellow', 'street', handling, 8)
    expect(red.vehicle.speed).toBeGreaterThan(blue.vehicle.speed * 1.07)
    expect(blue.vehicle.speed).toBeGreaterThan(green.vehicle.speed)
    expect(green.vehicle.speed).toBeGreaterThan(yellow.vehicle.speed)
    expect(red.distance).toBeGreaterThan(blue.distance * 1.05)
  })

  it('keeps the heavy Yellow slower off the line without making Green sluggish', () => {
    const red = drive('red', 'street', handling, 1.5)
    const blue = drive('blue', 'street', handling, 1.5)
    const green = drive('green', 'street', handling, 1.5)
    const yellow = drive('yellow', 'street', handling, 1.5)
    expect(red.distance).toBeGreaterThan(blue.distance)
    expect(green.distance).toBeGreaterThan(yellow.distance * 1.15)
    expect(blue.distance).toBeGreaterThan(yellow.distance * 1.1)
  })

  it('gives the off-road Yellow and versatile Green a speed advantage over Red on dirt', () => {
    const yellow = drive('yellow', 'dirt', handling, 8)
    const green = drive('green', 'dirt', handling, 8)
    const red = drive('red', 'dirt', handling, 8)
    expect(yellow.vehicle.speed).toBeGreaterThan(red.vehicle.speed * 1.15)
    expect(green.vehicle.speed).toBeGreaterThan(red.vehicle.speed * 1.1)
  })
})
