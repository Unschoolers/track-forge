import { describe, expect, it } from 'vitest'
import { advanceArcadeTimingGate } from '@/domain/race/arcadeTimingGate'
import { createRace } from '@/domain/race/raceFactory'
import { recoverRacePlayer, resetMissedCheckpoint } from '@/domain/race/raceRecovery'
import { stepRace } from '@/domain/race/raceEngine'
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

  it.each([false, true])('returns a missed circuit finish to the approach without adding a lap (reversed=%s)', reversed => {
    const path = buildRoadPath([
      street(0, 0), street(800, 0), street(800, 800), street(0, 800), street(0, 0),
    ], EMPTY_TERRAIN)
    const race = createRace({
      path, handling: 'arcade', startRatio: 0.18, reversed,
      playerCar: 'blue', difficulty: 'normal', laps: 2,
    })
    const count = path.points.length
    const direction = reversed ? -1 : 1
    const pointAt = (progress: number) => {
      const index = ((race.startPathIndex + direction * progress) % count + count) % count
      const point = path.points[index]
      if (!point) throw new Error('Missing road sample')
      return { index, point }
    }
    const beyondFinish = pointAt(3)
    const starting = race.vehicles[0]
    if (!starting) throw new Error('Missing player')
    const player = {
      ...starting, x: beyondFinish.point.x, y: beyondFinish.point.y,
      pathIndex: beyondFinish.index, lastRoadContactIndex: beyondFinish.index,
      nextSector: 4 as const, lap: 1,
    }
    const missed = {
      ...race, phase: 'running' as const, vehicles: [player],
      missedCheckpoint: {
        gate: 4 as const, remainingSeconds: 4,
        position: { x: beyondFinish.point.x, y: beyondFinish.point.y },
      },
    }

    const manually = recoverRacePlayer(missed)
    const recovered = manually.vehicles[0]
    if (!recovered) throw new Error('Missing recovered player')
    const progress = ((direction * (recovered.pathIndex - race.startPathIndex)) % count + count) % count
    expect(progress).toBeGreaterThan(count - 16)
    expect(progress).toBeLessThan(count)
    expect(recovered.pathIndex).not.toBe(beyondFinish.index)
    expect(recovered.nextSector).toBe(4)
    expect(recovered.lap).toBe(1)
    expect(recovered.finishedAt).toBeNull()
    expect(manually.missedCheckpoint).toBeUndefined()

    const beforeFinish = pointAt(count - 2)
    const afterFinish = pointAt(2)
    const crossing = advanceArcadeTimingGate(
      { ...missed, missedCheckpoint: undefined },
      { ...recovered, x: beforeFinish.point.x, y: beforeFinish.point.y, pathIndex: beforeFinish.index },
      { ...recovered, x: afterFinish.point.x, y: afterFinish.point.y, pathIndex: afterFinish.index },
      31, true, () => true,
    )
    expect(crossing.vehicle.lap).toBe(2)
    expect(crossing.vehicle.finishedAt).toBe(31)

    const automatic = stepRace(
      { ...missed, missedCheckpoint: { ...missed.missedCheckpoint, remainingSeconds: 0.001 } },
      { steering: 0, throttle: 0, braking: true }, 1 / 60, { next: () => 0.5 },
    )
    const autoCar = automatic.state.vehicles[0]
    if (!autoCar) throw new Error('Missing automatically recovered player')
    const autoProgress = ((direction * (autoCar.pathIndex - race.startPathIndex)) % count + count) % count
    expect(autoProgress).toBeGreaterThan(count - 16)
    expect(autoProgress).toBeLessThan(count)
    expect(autoCar.lap).toBe(1)
    expect(autoCar.nextSector).toBe(4)
    expect(automatic.events).toContainEqual(expect.objectContaining({
      type: 'vehicle-recovered', reason: 'missed-checkpoint',
    }))
  })

  it('respawns before the finish of an open stage rather than at the endpoint', () => {
    const path = buildRoadPath([street(0, 16), street(1_000, 16)], EMPTY_TERRAIN, undefined, 'point-to-point')
    const race = createRace({
      path, routeKind: 'point-to-point', handling: 'arcade',
      playerCar: 'blue', difficulty: 'normal', laps: 1,
    })
    const last = path.points.length - 1
    const finish = path.points[last]
    const starting = race.vehicles[0]
    if (!starting || !finish) throw new Error('Missing stage fixture')
    const player = {
      ...starting, nextSector: 4 as const, pathIndex: last,
      lastRoadContactIndex: last, x: finish.x + 10, y: finish.y + 90,
    }
    const state = {
      ...race, phase: 'running' as const, vehicles: [player],
      missedCheckpoint: { gate: 4 as const, remainingSeconds: 4, position: { x: finish.x, y: finish.y } },
    }
    const recovered = resetMissedCheckpoint(player, state)
    expect(recovered.pathIndex).toBeGreaterThan(last - 15)
    expect(recovered.pathIndex).toBeLessThan(last)
    expect(recovered.nextSector).toBe(4)
    expect(recovered.lap).toBe(0)
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
