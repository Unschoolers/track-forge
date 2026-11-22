import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { resetMissedCheckpoint } from '@/domain/race/raceRecovery'
import { forwardRecoveryDistance } from '@/domain/race/recoveryCheckpoints'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { asTrackId } from '@/domain/model'

describe('missing Finish cannot silently add an extra lap', () => {
  it.each([false, true])('resets before the same lap Finish in reverse=%s', reversed => {
    const track = createStarterTrack(asTrackId('missed-finish-regression'), 1)
    const path = buildRoadPath(track.points, track.terrain)
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2, reversed })
    const original = race.vehicles.find(vehicle => vehicle.player)
    if (!original) throw new Error('Missing player fixture')
    const count = path.points.length
    const afterFinish = (race.startPathIndex + (reversed ? -1 : 1) * 4 + count) % count
    const player = {
      ...original, nextSector: 4 as const, lap: 1,
      pathIndex: afterFinish, lastRoadContactIndex: afterFinish,
    }
    const recovered = resetMissedCheckpoint(player, {
      ...race, missedCheckpoint: { gate: 4, position: { x: player.x, y: player.y }, remainingSeconds: 0 },
    })
    const progress = forwardRecoveryDistance(race.startPathIndex, recovered.pathIndex, count, reversed, true)
    expect(progress).toBeGreaterThan(count / 2)
    expect(progress).toBeLessThan(count)
    expect(recovered.lap).toBe(1)
    expect(recovered.nextSector).toBe(4)
    expect(recovered.finishedAt).toBeNull()
  })
})
