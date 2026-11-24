import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { authoredRecoveryTarget, lastRoadRecoveryTarget } from '@/domain/race/recoveryCheckpoints'
import { asTrackId } from '@/domain/model'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createStarterTrack } from '@/domain/track/starterTrack'

const track = createStarterTrack(asTrackId('shared-recovery-gate'), 1)
const path = buildRoadPath(track.points, track.terrain)

describe('recovery checkpoint eligibility', () => {
  it.each([false, true])('applies the same timing gate limit to road contacts and markers (reversed: %s)', reversed => {
    const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75], path, playerCar: 'blue', difficulty: 'normal', laps: 2, reversed })
    const player = race.vehicles.find(vehicle => vehicle.player)
    if (!player) throw new Error('Expected player vehicle')
    const count = path.points.length
    const sign = reversed ? -1 : 1
    const indexAt = (progress: number) =>
      ((race.startPathIndex + sign * progress) % count + count) % count
    const beforeGate = indexAt(Math.floor(count / 8))
    const afterGate = indexAt(Math.floor(count / 2))
    const allowed = { ...player, nextSector: 1 as const, lastRoadContactIndex: beforeGate, recoveryCheckpoint: beforeGate }
    expect(lastRoadRecoveryTarget(race, allowed)).toBe(beforeGate)
    expect(authoredRecoveryTarget({ ...race, recoveryCheckpoints: [beforeGate] }, allowed)).toBe(beforeGate)

    const forbidden = { ...allowed, lastRoadContactIndex: afterGate, recoveryCheckpoint: afterGate }
    expect(lastRoadRecoveryTarget(race, forbidden)).toBeUndefined()
    expect(authoredRecoveryTarget({ ...race, recoveryCheckpoints: [afterGate] }, forbidden)).toBeUndefined()
  })

  it('rejects malformed and missing road indices instead of attempting unsafe recovery', () => {
    const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75], path, playerCar: 'blue', difficulty: 'normal', laps: 2 })
    const player = race.vehicles.find(vehicle => vehicle.player)
    if (!player) throw new Error('Expected player vehicle')
    const invalid = { ...player, nextSector: 1 as const, lastRoadContactIndex: path.points.length + 1, recoveryCheckpoint: path.points.length + 1 }
    expect(lastRoadRecoveryTarget(race, invalid)).toBeUndefined()
    expect(authoredRecoveryTarget({ ...race, recoveryCheckpoints: [invalid.recoveryCheckpoint] }, invalid)).toBeUndefined()
  })
})
