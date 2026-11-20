import { describe, expect, it } from 'vitest'
import { CAR_IDS, asTrackId, type CarId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { stepPlayer } from '@/domain/race/vehiclePhysics'

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
