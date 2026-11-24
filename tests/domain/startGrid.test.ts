// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { gridPositionsForPlayer, randomGridPositions, validGridPositions, validNearbyGridPositions } from '@/domain/race/startGrid'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createCup, cupGridPositions, recordCupResult } from '@/application/race/circuitCup'
import type { RaceStanding } from '@/application/race/raceSession'

const track = createStarterTrack(asTrackId('grid'), 1)
const path = buildRoadPath(track.points, track.terrain)

describe('starting grids', () => {
  it('shuffles every racer and physical pad exactly once, with deterministic injected rolls', () => {
    expect(randomGridPositions(4, () => 0)).toEqual([1, 2, 3, 0])
    expect(randomGridPositions(4, () => 0.999)).toEqual([0, 1, 2, 3])
    expect(randomGridPositions(2, () => 0)).toEqual([1, 0])
    expect(() => randomGridPositions(0)).toThrow(RangeError)
    expect(() => randomGridPositions(9)).toThrow(RangeError)
    expect(randomGridPositions(8, () => 0.999)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(() => randomGridPositions(4, () => 1)).toThrow(RangeError)
    expect(validGridPositions([3, 1, 0, 2])).toBe(true)
    expect(validGridPositions([0, 0, 1, 2])).toBe(false)
    expect(validGridPositions([0, 1, 2, 9])).toBe(false)
    expect(validGridPositions([0, 1, 2])).toBe(false)
    expect(validNearbyGridPositions([7, 0, 1, 2])).toBe(true)
    expect(validNearbyGridPositions([8, 0, 1, 2])).toBe(false)
  })

  it('keeps player/rival IDs and cars stable while moving each to a distinct physical pad', () => {
    const setup = { path, playerCar: 'green' as const, difficulty: 'hard' as const, laps: 1 }
    const fixed = createRace(setup)
    const shuffled = createRace({ ...setup, gridPositions: [3, 0, 1, 2] })
    expect(shuffled.vehicles.map((racer) => racer.id)).toEqual(fixed.vehicles.map((racer) => racer.id))
    expect(shuffled.vehicles.map((racer) => racer.car)).toEqual(fixed.vehicles.map((racer) => racer.car))
    for (const [index, pad] of [3, 0, 1, 2].entries()) {
      expect(shuffled.vehicles[index]?.x).toBeCloseTo(fixed.vehicles[pad]!.x)
      expect(shuffled.vehicles[index]?.y).toBeCloseTo(fixed.vehicles[pad]!.y)
    }
    expect(shuffled.cameraHints.target).toEqual({
      x: shuffled.vehicles[0]?.x, y: shuffled.vehicles[0]?.y,
    })
    expect(createRace({ ...setup, gridPositions: [0, 0, 1, 2] }).vehicles).toEqual(fixed.vehicles)
  })

  it('places a local nearby player on its synchronized physical pad', () => {
    const base = { path, playerCar: 'red' as const, difficulty: 'hard' as const, laps: 2 }
    const spots = Array.from({ length: 4 }, (_, pad) => {
      const initial = createRace({ ...base, gridPositions: gridPositionsForPlayer(pad) })
      return initial.vehicles[0]
    })
    const reference = createRace(base)
    for (let pad = 0; pad < 4; pad++) {
      expect(spots[pad]).toMatchObject({ id: 'player', player: true, car: 'red' })
      expect(spots[pad]?.x).toBeCloseTo(reference.vehicles[pad]!.x)
      expect(spots[pad]?.y).toBeCloseTo(reference.vehicles[pad]!.y)
    }
  })

  it('places eight Nearby racers at distinct physical pads without adding solo AI cars', () => {
    const points = Array.from({ length: 8 }, (_, slot) => {
      const positions = gridPositionsForPlayer(slot)
      const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2, gridPositions: positions })
      expect(race.vehicles).toHaveLength(4)
      const player = race.vehicles[0]
      expect(player).toBeDefined()
      return `${player!.x.toFixed(2)},${player!.y.toFixed(2)}`
    })
    expect(new Set(points).size).toBe(8)
  })

  it('reverses championship standings, but randomizes the first track', () => {
    const first = createCup('blue', 'hard')
    expect(cupGridPositions(first, () => 0)).toEqual([1, 2, 3, 0])
    const standings = ['player', 'ai-1', 'ai-2', 'ai-3'].map((id, index) => ({
      id, car: (['blue', 'red', 'green', 'yellow'] as const)[index]!,
      player: id === 'player', place: index + 1, finishTime: index + 20,
      lap: 1,
    })) satisfies RaceStanding[]
    const next = recordCupResult(first, standings)
    expect(cupGridPositions(next)).toEqual([3, 2, 1, 0])
  })
})
