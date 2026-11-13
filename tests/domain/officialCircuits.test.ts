import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { buildRoadPath } from '@/domain/track/pathBuilder'

describe('new official circuits', () => {
  const additions = OFFICIAL_CIRCUITS.filter(({ track }) =>
    ['official-quarry', 'official-switchback'].includes(track.id))

  it('offers a long, unbroken passing straight on Quarry Run', () => {
    const quarry = additions.find(({ track }) => track.id === 'official-quarry')
    expect(quarry).toBeDefined()
    const path = buildRoadPath(quarry!.track.points, quarry!.track.terrain)
    const straight = path.points.filter((point) => point.y < -280)
    expect(straight.at(-1)!.distance - straight[0]!.distance).toBeGreaterThan(700)
    expect(straight.every((point) => point.surface === 'street')).toBe(true)
  })

  it('separates the two branches at Switchback Viaduct', () => {
    const viaduct = additions.find(({ track }) => track.id === 'official-switchback')
    expect(viaduct).toBeDefined()
    const path = buildRoadPath(viaduct!.track.points, viaduct!.track.terrain)
    expect(path.crossings).toHaveLength(1)
    const crossing = path.crossings[0]!
    expect(crossing.upperPathIndex).not.toBeNull()
    expect(Math.abs(crossing.firstHeight - crossing.secondHeight)).toBeGreaterThan(15)
  })

  it('fits the full start grid in both directions on each new layout', () => {
    expect(additions).toHaveLength(2)
    for (const { track } of additions) {
      const path = buildRoadPath(track.points, track.terrain)
      for (const reversed of [false, true]) {
        const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1, reversed, startRatio: track.start?.ratio ?? 0 })
        expect(race.vehicles.every((vehicle) => getVehicleStepContext(path, vehicle).onRoad)).toBe(true)
      }
    }
  })
})
