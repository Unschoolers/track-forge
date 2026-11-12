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
