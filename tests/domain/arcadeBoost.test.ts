import { describe, expect, it } from 'vitest'
import { advanceArcadeBoost } from '@/domain/race/arcadeBoost'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'

describe('arcade drift boost', () => {
  it('charges during controlled slides and activates after steering release', () => {
    let boost = { charge: 0, remaining: 0 }
    for (let step = 0; step < 85; step += 1) {
      boost = advanceArcadeBoost(boost, {
        speed: 180,
        slip: 35,
        steering: 0.6,
        grounded: true,
      }, 1 / 60)
    }
    expect(boost.charge).toBe(1)
    expect(boost.remaining).toBe(0)
    const activated = advanceArcadeBoost(boost, {
      speed: 180,
      slip: 4,
      steering: 0,
      grounded: true,
    }, 1 / 60)
    expect(activated.activated).toBe(true)
    expect(activated.remaining).toBeGreaterThan(1)
    expect(activated.charge).toBe(0)
    const continuing = advanceArcadeBoost(activated, {
      speed: 240,
      slip: 0,
      steering: 0,
      grounded: true,
    }, 1 / 60)
    expect(continuing.activated).toBe(false)
    expect(continuing.remaining).toBeLessThan(activated.remaining)
  })

  it('never overrides a held brake and remains disabled in Simulation mode', () => {
    const track = createStarterTrack(asTrackId('boost-braking'), 1)
    const path = buildRoadPath(track.points, track.terrain)
    const started = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2 })
    const initial = started.vehicles[0]
    if (!initial) throw new Error('Missing player')
    const player = {
      ...initial,
      vx: Math.cos(initial.angle) * 150,
      vy: Math.sin(initial.angle) * 150,
      speed: 150,
    }
    const race = { ...started, phase: 'running' as const, elapsed: 2, vehicles: [player], boostRemaining: 1 }
    const random = { next: () => 0.5 }
    const brake = { steering: 0, throttle: 1, braking: true }
    const withBoost = stepRace(race, brake, 1 / 60, random)
    const noBoost = stepRace({ ...race, boostRemaining: 0 }, brake, 1 / 60, random)
    expect(withBoost.state.vehicles[0]?.speed).toBeCloseTo(noBoost.state.vehicles[0]?.speed ?? -1)
    const simulated = { ...race, handling: 'simulation' as const }
    const simBoost = stepRace(simulated, { ...brake, braking: false }, 1 / 60, random)
    const simNoBoost = stepRace({ ...simulated, boostRemaining: 0 }, { ...brake, braking: false }, 1 / 60, random)
    expect(simBoost.state.vehicles[0]?.speed).toBeCloseTo(simNoBoost.state.vehicles[0]?.speed ?? -1)
  })

  it('does not charge when airborne or driving straight and resets in simulation', () => {
    const sample = { speed: 200, slip: 40, steering: 0.5, grounded: false }
    expect(advanceArcadeBoost({ charge: 0, remaining: 0 }, sample, 1 / 60).charge).toBe(0)
    expect(advanceArcadeBoost({ charge: 0, remaining: 0 }, {
      ...sample, grounded: true, steering: 0,
    }, 1 / 60).charge).toBe(0)
    expect(advanceArcadeBoost({ charge: 0.7, remaining: 1 }, sample, 1 / 60, false))
      .toEqual({ charge: 0, remaining: 0, activated: false })
  })
})
