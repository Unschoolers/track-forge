import { describe, expect, it } from 'vitest'
import { forwardRecoveryDistance, planMissedCheckpointRecovery } from '@/domain/race/recoveryCheckpoints'
import { resetMissedCheckpoint } from '@/domain/race/raceRecovery'
import { createRace } from '@/domain/race/raceFactory'
import { asTrackId } from '@/domain/model'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createStarterTrack } from '@/domain/track/starterTrack'

const track = createStarterTrack(asTrackId('missed-recovery-plan'), 1)
const path = buildRoadPath(track.points, track.terrain)

describe('missed checkpoint recovery planning', () => {
  const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2 })
  const player = race.vehicles.find(vehicle => vehicle.player)
  if (!player) throw new Error('Missing race player fixture')

  it('prefers the last supported road contact before the pending timing gate', () => {
    const contact = (race.startPathIndex + Math.floor(path.points.length / 8)) % path.points.length
    const updated = { ...player, nextSector: 2 as const, pathIndex: contact, lastRoadContactIndex: contact }
    const plan = planMissedCheckpointRecovery(race, updated)
    expect(plan).toMatchObject({
      anchorIndex: contact, pathIndex: contact, waterRecoveryProtected: false,
    })
  })

  it('never restores to road contact beyond the next pending timing gate', () => {
    const beyond = (race.startPathIndex + Math.floor(path.points.length / 2)) % path.points.length
    const updated = { ...player, nextSector: 1 as const, lastRoadContactIndex: beyond }
    const plan = planMissedCheckpointRecovery(race, updated)
    expect(plan).not.toBeUndefined()
    expect(plan?.pathIndex).not.toBe(beyond)
  })

  it('restores a missed finish on the approach side, not into the next lap', () => {
    const missedFinish = {
      ...race,
      missedCheckpoint: { gate: 4 as const, remainingSeconds: 0, position: { x: 0, y: 0 } },
    }
    const recovered = resetMissedCheckpoint({
      ...player,
      nextSector: 4 as const,
      // The latest contact may be just after Start on the next lap.
      lastRoadContactIndex: race.startPathIndex,
    }, missedFinish)
    const progress = forwardRecoveryDistance(
      race.startPathIndex, recovered.pathIndex, path.points.length, false, path.closed,
    )
    expect(progress).toBeGreaterThan(path.points.length / 2)
    expect(progress).toBeLessThan(path.points.length)
    expect(recovered.nextSector).toBe(4)
    expect(recovered.lap).toBe(player.lap)
  })

  it('returns no plan when there are no samples to recover onto', () => {
    expect(planMissedCheckpointRecovery({ ...race, path: { ...path, points: [] } }, player))
      .toBeUndefined()
  })
})
