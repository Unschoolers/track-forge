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
  }))
}

describe('race effects', () => {
  it('emits surface dust and skids instead of smoke on loose ground', () => {
    const next = advanceRaceEffects(
      createRaceEffectsState(),
      vehicles(),
      [],
      0.033,
      { next: () => 0 },
    )

    expect(new Set(next.particles.map(({ kind }) => kind))).toEqual(
      new Set(['dirt']),
    )
    expect(next.skids).toHaveLength(2)
  })

  it('emits smoke on asphalt and snow powder on sliding ice', () => {
    const player = vehicles()[0]
    if (!player) throw new Error('Missing player fixture')
    for (const [currentSurface, kind] of [['street', 'tire-smoke'], ['ice', 'ice']] as const) {
      const next = advanceRaceEffects(createRaceEffectsState(), [{ ...player, currentSurface }], [], 1 / 60, { next: () => 0 })
      expect(next.particles.map(item => item.kind)).toEqual([kind])
    }
  })

  it('places wind at the side and scales with speed without extra random draws', () => {
    const player = vehicles()[0]
    if (!player) throw new Error('Missing player fixture')
    const sample = (speed: number) => {
      let draws = 0
      const result = advanceRaceEffects(createRaceEffectsState(), [{ ...player, x: 0, y: 0, angle: 0, vx: speed, vy: 0, speed, braking: false, slip: 0, currentSurface: 'street' }], [], 1 / 60, { next: () => { draws++; return 0 } })
      expect(draws).toBe(3)
      return result.particles.find(p => p.kind === 'speed-line')
    }
    const slow = sample(220), fast = sample(340)
    expect(Math.abs(slow?.y ?? 0)).toBeGreaterThan(10)
    expect(fast?.size).toBeGreaterThan(slow?.size ?? 0)
    expect(fast?.vx).toBeLessThan(slow?.vx ?? 0)
  })

  it('splashes at water contact, not the recovered vehicle position', () => {
    const next = advanceRaceEffects(createRaceEffectsState(), [], [{ type: 'vehicle-recovered', reason: 'water', x: 12, y: 34 }], 1 / 60, { next: () => 1 })
    expect(next.particles).toHaveLength(8)
    expect(next.particles.every(p => p.kind === 'water' && p.x === 12 && p.y === 34)).toBe(true)
  })

  it('tracks the left and right rear tires independently through a turn', () => {
    const player = vehicles()[0]
    if (!player) throw new Error('Missing player fixture')
    const car = { ...player, x: 0, y: 0, angle: 0, vx: 100, vy: 0, currentSurface: 'street' as const }
    const first = advanceRaceEffects(createRaceEffectsState(), [car], [], 1 / 60, { next: () => 0 })
    expect(first.skids.map(mark => mark.end)).toEqual([{ x: -10, y: -7 }, { x: -10, y: 7 }])
    const second = advanceRaceEffects(first, [{ ...car, x: 2, angle: 0.1 }], [], 1 / 60, { next: () => 0 })
    const pair = second.skids.slice(-2)
    expect(pair.map(mark => mark.start)).toEqual(first.skids.map(mark => mark.end))
    const [left, right] = pair
    if (!left || !right) throw new Error('Missing rear tire pair')
    expect(Math.hypot(left.end.x - right.end.x, left.end.y - right.end.y)).toBeCloseTo(14)
    const recovered = advanceRaceEffects(second, [{ ...car, x: 1000 }], [{ type: 'vehicle-recovered', vehicleId: car.id }], 1 / 60, { next: () => 0 })
    expect(recovered.skids).toHaveLength(second.skids.length)
  })

  it('expires descriptors and bounds retained arrays', () => {
    let effects = createRaceEffectsState()
    for (let index = 0; index < 300; index += 1) {
      effects = advanceRaceEffects(
        effects,
        vehicles(),
        [],
        0.001,
        { next: () => 0 },
      )
    }
    expect(effects.particles.length).toBeLessThanOrEqual(180)
    expect(effects.skids.length).toBeLessThanOrEqual(240)

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
