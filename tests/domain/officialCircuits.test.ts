import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { validateTrack } from '@/domain/track/trackValidation'

describe('checkpoint-authored official circuits', () => {
  it('ships complete circuits with valid authored gates', () => {
    expect(OFFICIAL_CIRCUITS.length).toBeGreaterThan(0)
    for (const { track } of OFFICIAL_CIRCUITS) {
      const path = buildRoadPath(track.points, track.terrain)
      expect(validateTrack(track, path.totalLength).ready).toBe(true)
      expect(track.recoveryCheckpoints?.length).toBeGreaterThan(0)
      const race = createRace({
        path, recoveryCheckpoints: track.recoveryCheckpoints,
        playerCar: 'blue', difficulty: 'normal', laps: 1,
        startRatio: track.start?.ratio ?? 0,
      })
      expect(race.timingGates).toHaveLength(track.recoveryCheckpoints?.length ?? 0)
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
        expect(race.timingGates).toHaveLength(track.recoveryCheckpoints?.length ?? 0)
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
