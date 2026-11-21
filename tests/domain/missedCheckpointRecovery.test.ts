import { describe, expect, it } from 'vitest'
import { advanceArcadeTimingGate } from '@/domain/race/arcadeTimingGate'
import { createRace } from '@/domain/race/raceFactory'
import { resetMissedCheckpoint } from '@/domain/race/raceRecovery'
import { crossesRoadGate, lastSampleBeforeCheckpoint } from '@/domain/race/progress'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'

const street = (x: number, y: number) => ({ x, y, surface: 'street' as const })

describe('missed timing gate recovery', () => {
  it('starts recovery when a stage car rejoins past a gate without crossing its line', () => {
    const path = buildRoadPath([street(0, 16), street(1_000, 16)], EMPTY_TERRAIN, undefined, 'point-to-point')
    const race = createRace({
      path, routeKind: 'point-to-point', handling: 'arcade',
      playerCar: 'blue', difficulty: 'normal', laps: 1,
    })
    const index = lastSampleBeforeCheckpoint(path, 1) + 4
    const point = path.points[index]
    const player = race.vehicles[0]
    if (!point || !player) throw new Error('Missing checkpoint fixture')
    const before = { ...player, x: point.x, y: point.y + 90, pathIndex: index }
    const after = { ...before, x: before.x + 2 }
    expect(crossesRoadGate(path, before, after, (path.points.length - 1) / 4, Infinity)).toBe(false)
    const result = advanceArcadeTimingGate(race, before, after, 6, false, () => false)

    expect(result.vehicle.nextSector).toBe(1)
    expect(result.missedCheckpoint).toMatchObject({ gate: 1, remainingSeconds: 5 })
  })

  it('starts recovery when the stage finish is bypassed beyond the painted line', () => {
    const path = buildRoadPath([street(0, 16), street(1_000, 16)], EMPTY_TERRAIN, undefined, 'point-to-point')
    const race = createRace({
      path, routeKind: 'point-to-point', handling: 'arcade',
      playerCar: 'blue', difficulty: 'normal', laps: 1,
    })
    const last = path.points.length - 1
    const finish = path.points[last]
    const player = race.vehicles[0]
    if (!player || !finish) throw new Error('Missing finish fixture')
    const before = { ...player, nextSector: 4 as const, x: finish.x + 10, y: finish.y + 90, pathIndex: last - 1 }
    const after = { ...before, x: before.x + 2, pathIndex: last }
    expect(crossesRoadGate(path, before, after, last, Infinity)).toBe(false)

    const result = advanceArcadeTimingGate(race, before, after, 6, false, () => false)
    expect(result.vehicle.finishedAt).toBeNull()
    expect(result.missedCheckpoint).toMatchObject({ gate: 4, remainingSeconds: 5 })
  })

  it.each([false, true])('detects a bypass on a circuit in both directions (reversed=%s)', reversed => {
    const path = buildRoadPath([
      street(0, 0), street(800, 0), street(800, 800), street(0, 800), street(0, 0),
    ], EMPTY_TERRAIN)
    const race = createRace({
      path, handling: 'arcade', startRatio: 0.18, reversed,
      playerCar: 'blue', difficulty: 'normal', laps: 2,
    })
    expect(path.closed).toBe(true)
    const count = path.points.length
    const player = race.vehicles[0]
    if (!player) throw new Error('Missing checkpoint fixture')
    const atProgress = (progress: number) => {
      const index = ((race.startPathIndex + (reversed ? -1 : 1) * progress) % count + count) % count
      const point = path.points[index]
      if (!point) throw new Error('Missing road sample')
      return { ...player, pathIndex: index, x: point.x + 90, y: point.y + 90 }
    }
    // The grid behind Start must never be mistaken for a skipped first sector.
    const behindStart = atProgress(count - Math.min(20, Math.floor(count / 16)))
    expect(advanceArcadeTimingGate(race, behindStart, behindStart, 1, false, () => false)
      .missedCheckpoint).toBeUndefined()

    const afterGate = atProgress(Math.floor(count / 4) + 5)
    const later = atProgress(Math.floor(count / 4) + 6)
    const gatePosition = ((race.startPathIndex + (reversed ? -1 : 1) * count / 4) % count + count) % count
    expect(crossesRoadGate(path, afterGate, later, gatePosition, Infinity, reversed)).toBe(false)
    const missed = advanceArcadeTimingGate(race, afterGate, later, 6, false, () => false)
    expect(missed.vehicle.nextSector).toBe(1)
    expect(missed.missedCheckpoint).toMatchObject({ gate: 1, remainingSeconds: 5 })

    // Brief reacquisition of the wrong road arm must not fabricate a miss.
    const changingArms = advanceArcadeTimingGate(
      race,
      { ...afterGate, recoveryAnchorIndex: race.startPathIndex },
      { ...later, recoveryAnchorIndex: race.startPathIndex },
      6, false, () => false,
    )
    expect(changingArms.missedCheckpoint).toBeUndefined()
  })

  it('finishes a timed reset even if every pre-gate road sample is flooded', () => {
    const flooded = {
      cellSize: 32,
      cells: Array.from({ length: 27 }, (_, column) => ({ column, row: 0, kind: 'water' as const })),
    }
    const path = buildRoadPath([street(0, 16), street(800, 16)], flooded, undefined, 'point-to-point')
    const race = createRace({
      path, routeKind: 'point-to-point', handling: 'arcade',
      playerCar: 'blue', difficulty: 'normal', laps: 1,
    })
    const player = race.vehicles[0]
    if (!player) throw new Error('Missing checkpoint fixture')
    const misplaced = { ...player, x: 490, y: 95 }
    const recovered = resetMissedCheckpoint(misplaced, race)

    expect(recovered).not.toBe(misplaced)
    expect(recovered.pathIndex).toBeLessThan(lastSampleBeforeCheckpoint(path, 1) + 1)
    expect(recovered.waterRecoveryProtected).toBe(true)
    expect(recovered.speed).toBe(0)
    expect(recovered.nextSector).toBe(1)
  })
})
