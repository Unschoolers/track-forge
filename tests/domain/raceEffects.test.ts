import { describe, expect, it } from 'vitest'
import {
  advanceRaceEffects,
  createRaceEffectsState,
} from '@/domain/race/effects'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'

const track = createStarterTrack(asTrackId('effects'), 1)
const path = buildRoadPath(track.points, track.terrain)

function vehicles() {
  const race = createRace({
    path,
    playerCar: 'blue',
    difficulty: 'normal',
    laps: 3,
  })
  return race.vehicles.map((vehicle, index) => ({
    ...vehicle,
    speed: index === 0 ? 140 : 80,
    vx: 100,
    slip: index === 0 ? 55 : 0,
    braking: index === 0,
    currentSurface: index === 0 ? ('dirt' as const) : vehicle.currentSurface,
    damage: index === 0 ? 3 : 0,
  }))
}

describe('race effects', () => {
  it('emits surface dust, skids, brake smoke, sparks, and damage smoke', () => {
    const next = advanceRaceEffects(
      createRaceEffectsState(),
      vehicles(),
      [{ type: 'collision', leftId: 'player', rightId: 'ai-1', strength: 80 }],
      0.033,
      { next: () => 0 },
    )

    expect(new Set(next.particles.map(({ kind }) => kind))).toEqual(
      new Set(['dirt', 'tire-smoke', 'spark', 'damage-smoke']),
    )
    expect(next.skids.length).toBeGreaterThan(0)
  })

  it('expires descriptors and bounds retained arrays', () => {
    let effects = createRaceEffectsState()
    for (let index = 0; index < 300; index += 1) {
      effects = advanceRaceEffects(
        effects,
        vehicles(),
        [{ type: 'collision', leftId: 'player', rightId: 'ai-1', strength: 80 }],
        0.001,
        { next: () => 0 },
      )
    }
    expect(effects.particles.length).toBeLessThanOrEqual(180)
    expect(effects.skids.length).toBeLessThanOrEqual(120)

    const expired = advanceRaceEffects(
      effects,
      [],
      [],
      5,
      { next: () => 1 },
    )
    expect(expired.particles).toHaveLength(0)
    expect(expired.skids).toHaveLength(0)
  })
})
