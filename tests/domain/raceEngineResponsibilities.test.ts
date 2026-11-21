import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { recoverRacePlayer, resetRaceVehicle, stepRace } from '@/domain/race/raceEngine'
import { advanceVehicle, raceVehicleContext } from '@/domain/race/raceVehicleStepper'

const track = createStarterTrack(asTrackId('recovery-extraction'), 1)
const path = buildRoadPath(track.points, track.terrain)
const random = { next: () => 0.5 }
const coast = { steering: 0, throttle: 0, braking: false }

describe('fixed-step orchestration and extracted race policies', () => {
  it('keeps manual recovery disabled while paused and restores a running off-course player', () => {
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1 })
    const player = race.vehicles[0]
    if (!player) throw new Error('Missing player')
    const offCourse = { ...player, x: player.x + 4000, y: player.y + 4000 }
    const running = { ...race, phase: 'running' as const, vehicles: [offCourse] }
    expect(recoverRacePlayer({ ...running, paused: true })).toMatchObject({ vehicles: [offCourse] })
    const recovered = recoverRacePlayer(running)
    const car = recovered.vehicles[0]
    expect(car).toBeDefined()
    expect(car).not.toBe(offCourse)
    expect(Math.hypot((car?.x ?? 4000) - offCourse.x, (car?.y ?? 4000) - offCourse.y))
      .toBeGreaterThan(100)
    expect(recovered.missedCheckpoint).toBeUndefined()
    expect(resetRaceVehicle(offCourse, running).x).toBeCloseTo(car?.x ?? Number.NaN)
  })

  it('maintains the same road context and finite physics for AI and direct controls', () => {
    const race = createRace({ path, playerCar: 'green', difficulty: 'hard', laps: 1 })
    const running = { ...race, phase: 'running' as const }
    const player = running.vehicles[0]
    const opponent = running.vehicles[1]
    if (!player || !opponent) throw new Error('Missing vehicles')
    expect(raceVehicleContext(running, player).nearest.index).toBeGreaterThanOrEqual(0)
    const controlled = advanceVehicle(player, running, { steering: 0, throttle: 1, braking: false }, 1 / 60, random, undefined)
    const automated = advanceVehicle(opponent, running, undefined, 1 / 60, random, undefined)
    for (const vehicle of [controlled, automated]) {
      expect(Number.isFinite(vehicle.x) && Number.isFinite(vehicle.y)).toBe(true)
      expect(Number.isFinite(vehicle.z) && Number.isFinite(vehicle.speed)).toBe(true)
    }
    const integrated = stepRace(running, coast, 1 / 60, random)
    expect(integrated.state.tick).toBe(running.tick + 1)
  })
})
