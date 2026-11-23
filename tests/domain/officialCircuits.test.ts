import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { validateTrack } from '@/domain/track/trackValidation'

describe('checkpoint-authored official circuits', () => {
  it('ships exactly three simple, complete, visibly marked circuits with props', () => {
    expect(OFFICIAL_CIRCUITS).toHaveLength(3)
    for (const { track } of OFFICIAL_CIRCUITS) {
      expect(track.points).toHaveLength(25)
      expect(track.autoCheckpoints).toBe(true)
      expect(track.scenery?.length).toBeGreaterThanOrEqual(4)
      const path = buildRoadPath(track.points, track.terrain)
      expect(path.crossings).toHaveLength(0)
      expect(validateTrack(track, path.totalLength).ready).toBe(true)
      expect(track.recoveryCheckpoints).toHaveLength(2)
      const race = createRace({
        path, recoveryCheckpoints: track.recoveryCheckpoints,
        playerCar: 'blue', difficulty: 'normal', laps: 1,
        startRatio: track.start?.ratio ?? 0,
      })
      expect(race.timingGates).toHaveLength(2)
      expect(race.timingGates?.every(index => index > 0 && index < path.points.length)).toBe(true)
    }
  })

  it('orders the actual markers independently for forward and reverse races', () => {
    for (const { track } of OFFICIAL_CIRCUITS) {
      const path = buildRoadPath(track.points, track.terrain)
      for (const reversed of [false, true]) {
        const race = createRace({
          path, recoveryCheckpoints: track.recoveryCheckpoints,
          playerCar: 'blue', difficulty: 'normal', laps: 1,
          reversed, startRatio: track.start?.ratio ?? 0,
        })
        expect(race.timingGates).toHaveLength(2)
        expect(race.vehicles.every(vehicle => getVehicleStepContext(path, vehicle).onRoad)).toBe(true)
      }
    }
  })

  it('keeps user layouts without authored checkpoints incomplete', () => {
    const track = OFFICIAL_CIRCUITS[0]!.track
    const path = buildRoadPath(track.points, track.terrain)
    expect(validateTrack({ ...track, recoveryCheckpoints: [] }, path.totalLength)).toMatchObject({
      ready: false, code: 'missing-checkpoints',
    })
  })
})
