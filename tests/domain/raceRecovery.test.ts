import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import { recoverRacePlayer, resetRaceVehicle, stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { createStarterTrack } from '@/domain/track/starterTrack'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture')
  return value
}

const random = { next: () => 0.5 }
const track = createStarterTrack(asTrackId('recovery'), 1)
const path = buildRoadPath(track.points, track.terrain)

function stoppedPlayerRace(stuckDuration = 0) {
  const race = createRace({
    path,
    playerCar: 'blue',
    difficulty: 'normal',
    laps: 3,
  })
  const index = 40
  const center = required(path.points[index])
  const before = required(path.points[index - 3])
  const after = required(path.points[index + 3])
  const angle = Math.atan2(after.y - before.y, after.x - before.x)
  const player = {
    ...required(race.vehicles[0]),
    x: center.x - Math.sin(angle) * 20,
    y: center.y + Math.cos(angle) * 20,
    angle: angle + 0.8,
    pathIndex: index,
    stuckDuration,
  }
  return { ...race, phase: 'running' as const, elapsed: 2, vehicles: [player] }
}

describe('automatic player recovery', () => {
  it('reports a short stuck-player reset so replay recording can reject it', () => {
    const race = stoppedPlayerRace(0.65)
    const result = stepRace(race,
      { steering: 0, throttle: 1, braking: false }, 1 / 60, random)
    expect(result.state.vehicles[0]?.stuckDuration).toBe(0)
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'vehicle-recovered', vehicleId: race.vehicles[0]?.id,
    }))
  })

  it('does not move or recover a stopped player holding the brake', () => {
    let race: RaceState = stoppedPlayerRace()
    const initial = required(race.vehicles[0])
    const context = getVehicleStepContext(path, initial)
    expect(context.onRoad).toBe(true)
    expect(context.nearest.distance).toBeGreaterThan(19)
    expect(context.nearest.distance).toBeLessThan(21)

    let greatestDisplacement = 0
    let greatestHeadingChange = 0
    let greatestStuckDuration = 0
    for (let frame = 0; frame < 90; frame += 1) {
      race = stepRace(
        race,
        { steering: 0, throttle: 1, braking: true },
        1 / 60,
        random,
      ).state
      const player = required(race.vehicles[0])
      greatestDisplacement = Math.max(
        greatestDisplacement,
        Math.hypot(player.x - initial.x, player.y - initial.y),
      )
      greatestHeadingChange = Math.max(
        greatestHeadingChange,
        Math.abs(player.angle - initial.angle),
      )
      greatestStuckDuration = Math.max(greatestStuckDuration, player.stuckDuration)
    }

    expect(race.phase).toBe('running')
    expect(greatestDisplacement).toBeLessThan(0.000001)
    expect(greatestHeadingChange).toBeLessThan(0.000001)
    expect(greatestStuckDuration).toBe(0)
  })

  it('lets previous stuck time decay when the brake is applied', () => {
    const race = stoppedPlayerRace(0.6)
    const player = required(
      stepRace(
        race,
        { steering: 0, throttle: 1, braking: true },
        1 / 60,
        random,
      ).state.vehicles[0],
    )

    expect(player.stuckDuration).toBeLessThan(0.6)
  })

  it.each([false, true])(
    'recovers an accelerating player pinned against a bridge wall (reversed: %s)',
    (reversed) => {
      const bridgePath = buildRoadPath(
        [
          { id: 'bridge', x: 0, y: 0, surface: 'street', structure: 'overpass' },
          { id: 'landing', x: 500, y: 0, surface: 'street' },
          { id: 'end', x: 900, y: 0, surface: 'street' },
        ],
        EMPTY_TERRAIN,
      )
      let race = createRace({
        path: bridgePath,
        playerCar: 'blue',
        difficulty: 'normal',
        laps: 3,
        reversed,
      })
      const index = bridgePath.points.findIndex((point) => point.distance >= 240)
      const center = required(bridgePath.points[index])
      const player = {
        ...required(race.vehicles[0]),
        x: center.x,
        y: center.y + 29,
        angle: Math.PI / 2,
        pathIndex: index,
        z: bridgePath.roadSurface.at(index).height,
      }
      race = { ...race, phase: 'running', elapsed: 2, vehicles: [player] }

      let greatestStuckDuration = 0
      for (let frame = 0; frame < 40; frame += 1) {
        race = stepRace(
          race,
          { steering: 0, throttle: 1, braking: false },
          1 / 60,
          random,
        ).state
        greatestStuckDuration = Math.max(
          greatestStuckDuration,
          required(race.vehicles[0]).stuckDuration,
        )
      }

      const recovered = required(race.vehicles[0])
      const expectedAngle = reversed ? Math.PI : 0
      const headingDifference = Math.atan2(
        Math.sin(recovered.angle - expectedAngle),
        Math.cos(recovered.angle - expectedAngle),
      )
      expect(greatestStuckDuration).toBeGreaterThan(0.6)
      expect(recovered.stuckDuration).toBeLessThan(0.05)
      expect(Math.abs(recovered.y - center.y)).toBeLessThan(1)
      expect(Math.abs(headingDifference)).toBeLessThan(0.05)
    },
  )
})

const closeArmsPath = buildRoadPath([
  { x: 0, y: 0, surface: 'street' },
  { x: 220, y: 0, surface: 'street' },
  { x: 440, y: 0, surface: 'street' },
  { x: 660, y: 0, surface: 'street' },
  { x: 880, y: 0, surface: 'street' },
  { x: 880, y: 100, surface: 'street' },
  { x: 660, y: 100, surface: 'street' },
  { x: 440, y: 100, surface: 'street' },
  { x: 220, y: 100, surface: 'street' },
  { x: 0, y: 100, surface: 'street' },
  { x: 0, y: 0, surface: 'street' },
], EMPTY_TERRAIN)

describe('fallback recovery on a circuit', () => {
  it.each([false, true])('stays on the previously followed road arm (reversed: %s)', reversed => {
    const race = createRace({
      path: closeArmsPath, playerCar: 'blue', difficulty: 'normal', laps: 3, reversed,
    })
    const index = required(nearestPathPoint(closeArmsPath, { x: 440, y: 0 })).index
    const player = {
      ...required(race.vehicles[0]), x: 440, y: 100, pathIndex: index,
      lap: 1, nextSector: reversed ? 4 as const : 1 as const, damage: 20,
    }
    const result = recoverRacePlayer({ ...race, phase: 'running', elapsed: 40, vehicles: [player] })
    expect(result.vehicles[0]).toMatchObject({
      x: expect.closeTo(440, -1), y: expect.closeTo(0),
      nextSector: player.nextSector, lap: 1, damage: 20, finishedAt: null,
    })
    expect(Math.cos(required(result.vehicles[0]).angle)).toBeCloseTo(reversed ? -1 : 1)
    expect(result.elapsed).toBe(40)
  })

  it('returns to a dry sample before a missed timing gate', () => {
    const wetPath = buildRoadPath([
      { x: -200, y: 16, surface: 'street' },
      { x: 200, y: 16, surface: 'street' },
      { x: 200, y: 216, surface: 'street' },
      { x: -200, y: 216, surface: 'street' },
      { x: -200, y: 16, surface: 'street' },
    ], { cellSize: 32, cells: [{ column: 0, row: 0, kind: 'water' }] })
    const wetIndex = required(nearestPathPoint(wetPath, { x: 16, y: 16 })).index
    const race = createRace({ path: wetPath, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    const player = {
      ...required(race.vehicles[0]), ...required(wetPath.points[wetIndex]), pathIndex: wetIndex,
    }
    const recovered = required(resetRaceVehicle(player, {
      ...race, startPathIndex: (wetIndex - Math.ceil(wetPath.points.length / 4) + wetPath.points.length) % wetPath.points.length,
    }))
    expect(recovered.x).toBeLessThan(0)
    expect(wetPath.terrainSurface.materialAt(recovered)).not.toBe('water')
    expect(recovered.nextSector).toBe(1)
  })

  it('retains the followed arm when automatically recovering on a displaced tick', () => {
    const race = createRace({ path: closeArmsPath, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    const index = required(nearestPathPoint(closeArmsPath, { x: 440, y: 0 })).index
    const player = {
      ...required(race.vehicles[0]), x: 440, y: 100, pathIndex: index, stuckDuration: 0.65,
    }
    const result = stepRace({ ...race, phase: 'running', elapsed: 2, vehicles: [player] },
      { steering: 0, throttle: 1, braking: false }, 1 / 60, random)
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'vehicle-recovered', reason: 'off-road' }))
    expect(result.state.vehicles[0]).toMatchObject({ y: expect.closeTo(0), nextSector: 1, lap: 0 })
    expect(result.events.some(event => event.type === 'gate-crossed')).toBe(false)
  })
})

it('still recovers to the original arm after a displaced non-recovery tick', () => {
  const race = createRace({ path: closeArmsPath, playerCar: 'blue', difficulty: 'normal', laps: 3 })
  const index = required(nearestPathPoint(closeArmsPath, { x: 440, y: 0 })).index
  const player = { ...required(race.vehicles[0]), x: 440, y: 100, pathIndex: index }
  const result = stepRace({ ...race, phase: 'running', elapsed: 2, vehicles: [player] },
    { steering: 0, throttle: 0, braking: true }, 1 / 60, random)
  const recovered = recoverRacePlayer(result.state)
  expect(recovered.vehicles[0]).toMatchObject({ y: expect.closeTo(0), nextSector: 1, lap: 0 })
  expect(result.events.some(event => event.type === 'gate-crossed')).toBe(false)
})

it.each([false, true])('does not recover at an authored checkpoint beyond the pending gate (reversed: %s)', reversed => {
  const race = createRace({ path: closeArmsPath, playerCar: 'blue', difficulty: 'normal', laps: 3, reversed })
  const count = closeArmsPath.points.length
  const direction = reversed ? -1 : 1
  const indexAt = (progress: number) => ((race.startPathIndex + direction * progress) % count + count) % count
  const anchor = indexAt(Math.floor(count / 8))
  const missed = indexAt(Math.ceil(count / 2))
  const player = { ...required(race.vehicles[0]), pathIndex: anchor, nextSector: 1 as const, recoveryCheckpoint: missed }
  const recovered = resetRaceVehicle(player, { ...race, recoveryCheckpoints: [missed] })
  expect(recovered.pathIndex).toBe(anchor)
  expect(recovered.nextSector).toBe(1)
})

it('clears the recovery anchor after sustained travel on a newly acquired arm', () => {
  const race = createRace({ path: closeArmsPath, playerCar: 'blue', difficulty: 'normal', laps: 3 })
  const origin = required(nearestPathPoint(closeArmsPath, { x: 440, y: 0 })).index
  const destination = required(nearestPathPoint(closeArmsPath, { x: 440, y: 100 })).index
  const player = { ...required(race.vehicles[0]), x: 440, y: 100, pathIndex: origin }
  const acquired = stepRace({ ...race, phase: 'running', elapsed: 2, vehicles: [player] },
    { steering: 0, throttle: 0, braking: true }, 1 / 60, random).state
  expect(required(acquired.vehicles[0]).recoveryAnchorIndex).toBe(origin)
  const farther = required(closeArmsPath.points[(destination + 16) % closeArmsPath.points.length])
  const moving = { ...required(acquired.vehicles[0]), x: farther.x, y: farther.y, pathIndex: (destination + 16) % closeArmsPath.points.length }
  const travelled = stepRace({ ...acquired, vehicles: [moving] },
    { steering: 0, throttle: 0, braking: true }, 1 / 60, random).state
  expect(required(travelled.vehicles[0]).recoveryAnchorIndex).toBeUndefined()
})


it('recovers at the last supported road position rather than the latest authored marker', () => {
  const race = createRace({ path: closeArmsPath, playerCar: 'blue', difficulty: 'normal', laps: 3 })
  const contact = required(nearestPathPoint(closeArmsPath, { x: 440, y: 0 })).index
  const player = {
    ...required(race.vehicles[0]),
    x: 440, y: 100, pathIndex: contact, lastRoadContactIndex: contact,
    recoveryCheckpoint: 0, nextSector: 2 as const, lap: 1,
  }
  const state = recoverRacePlayer({ ...race, phase: 'running', vehicles: [player], recoveryCheckpoints: [0] })
  expect(state.vehicles[0]).toMatchObject({
    x: expect.closeTo(440, -1), y: expect.closeTo(0), lastRoadContactIndex: contact,
    nextSector: 2, lap: 1,
  })
})

it('never uses road contact across an unpassed timing gate', () => {
  const race = createRace({ path: closeArmsPath, playerCar: 'blue', difficulty: 'normal', laps: 3 })
  const count = closeArmsPath.points.length
  const beforeGate = Math.floor(count / 8)
  const beyondGate = Math.floor(count / 2)
  const player = {
    ...required(race.vehicles[0]), pathIndex: beforeGate,
    lastRoadContactIndex: beyondGate, nextSector: 1 as const,
  }
  const recovered = resetRaceVehicle(player, race)
  expect(recovered.pathIndex).toBeLessThan(Math.ceil(count / 4))
  expect(recovered.nextSector).toBe(1)
})
