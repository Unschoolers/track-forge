import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import {
  solveCollisionFrame,
  solveCollisions,
} from '@/domain/race/collisions'
import { updateProgress } from '@/domain/race/progress'
import { stepPlayer } from '@/domain/race/vehiclePhysics'
import { stepRace } from '@/domain/race/raceEngine'
import { rankVehicles } from '@/domain/race/ranking'
import { solveBridgeBarrierFrame } from '@/domain/race/bridgeBarriers'
import {
  VERTICAL_DYNAMICS,
  WORLD_ELEVATION,
} from '@/domain/config'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'

const track = createStarterTrack(asTrackId('starter'), 1)
const path = buildRoadPath(track.points, track.terrain)

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected test fixture value')
  return value
}

describe('race simulation', () => {
  it('creates a deterministic four-car starting grid', () => {
    const first = createRace({
      path,
      playerCar: 'green',
      difficulty: 'hard',
      laps: 3,
    })
    const second = createRace({
      path,
      playerCar: 'green',
      difficulty: 'hard',
      laps: 3,
    })

    expect(first.vehicles).toHaveLength(4)
    expect(first.vehicles[0]).toMatchObject({
      player: true,
      car: 'green',
      lap: 0,
      damageLimit: 3,
      z: 0,
      verticalVelocity: 0,
      grounded: true,
      contactLoad: 1,
    })
    expect(second).toEqual(first)
  })

  it('accelerates, steers, and brakes according to car and surface tuning', () => {
    const race = createRace({
      path,
      playerCar: 'red',
      difficulty: 'normal',
      laps: 3,
    })
    const player = required(race.vehicles[0])
    let rolling = player
    for (let frame = 0; frame < 12; frame += 1) {
      rolling = stepPlayer(
        rolling,
        { steering: 0, throttle: 1, braking: false },
        'street',
        0.05,
      )
    }
    const steered = stepPlayer(
      rolling,
      { steering: 1, throttle: 1, braking: false },
      'street',
      0.05,
    )
    const street = stepPlayer(
      rolling,
      { steering: 0, throttle: 1, braking: false },
      'street',
      0.05,
    )
    const dirt = stepPlayer(
      rolling,
      { steering: 0, throttle: 1, braking: false },
      'dirt',
      0.05,
    )
    const braking = stepPlayer(
      rolling,
      { steering: 0, throttle: 0, braking: true },
      'street',
      0.05,
    )

    expect(rolling.speed).toBeGreaterThan(player.speed)
    expect(steered.yawRate).not.toBe(0)
    expect(steered.angle).not.toBe(rolling.angle)
    expect(dirt.speed - rolling.speed).toBeLessThan(
      street.speed - rolling.speed,
    )
    expect(braking.speed).toBeLessThan(rolling.speed)
  })

  it('tracks forward lap crossings and finish time', () => {
    const vehicle = required(
      createRace({
        path,
        playerCar: 'blue',
        difficulty: 'normal',
        laps: 1,
      }).vehicles[0],
    )
    const nearEnd = {
      ...vehicle,
      pathIndex: path.points.length - 3,
      lap: 0,
      nextSector: 4 as const,
    }
    const finished = updateProgress(nearEnd, 2, path.points.length, 12.5, 1)

    expect(finished).toMatchObject({ lap: 1, finishedAt: 12.5 })
  })

  it('does not count a backward start-line wrap', () => {
    const vehicle = required(
      createRace({
        path,
        playerCar: 'blue',
        difficulty: 'normal',
        laps: 3,
      }).vehicles[0],
    )
    const nearStart = { ...vehicle, pathIndex: 2, lap: 1 }

    expect(
      updateProgress(
        nearStart,
        path.points.length - 3,
        path.points.length,
        4,
        3,
      ),
    ).toMatchObject({ lap: 1, finishedAt: null })
  })

  it('rejects a shortcut across the start line before all sectors', () => {
    const vehicle = required(
      createRace({
        path,
        playerCar: 'blue',
        difficulty: 'normal',
        laps: 1,
      }).vehicles[0],
    )
    const shortcut = updateProgress(
      { ...vehicle, pathIndex: path.points.length - 3, nextSector: 2 },
      2,
      path.points.length,
      5,
      1,
    )

    expect(shortcut).toMatchObject({
      lap: 0,
      nextSector: 1,
      finishedAt: null,
    })
  })

  it('updates every vehicle from its post-movement nearest path point', () => {
    const race = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const displaced = {
      ...race,
      phase: 'running' as const,
      vehicles: race.vehicles.map((vehicle, index) => {
        const point = required(path.points[40 + index * 10])
        return { ...vehicle, x: point.x, y: point.y, pathIndex: 0 }
      }),
    }

    const stepped = stepRace(
      displaced,
      { steering: 0, throttle: 0, braking: false },
      0.001,
      { next: () => 0.5 },
    )

    expect(stepped.state.vehicles.every((vehicle) => vehicle.pathIndex > 20))
      .toBe(true)
  })

  it('applies vertical gravity to player and AI vehicles in one common pass', () => {
    const race = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const airborne = {
      ...race,
      phase: 'running' as const,
      vehicles: race.vehicles.map((vehicle) => ({
        ...vehicle,
        z: 5,
        verticalVelocity: 0,
        grounded: false,
        contactLoad: 0,
      })),
    }

    const stepped = stepRace(
      airborne,
      { steering: 0, throttle: 0, braking: false },
      0.05,
      { next: () => 0.5 },
    )

    expect(stepped.state.vehicles.every(({ z }) => z < 5)).toBe(true)
    expect(
      stepped.state.vehicles.every(
        ({ verticalVelocity }) => verticalVelocity < 0,
      ),
    ).toBe(true)
  })

  it('turns a hard player landing into bounded camera shake', () => {
    const race = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const landing = {
      ...race,
      phase: 'running' as const,
      vehicles: race.vehicles.map((vehicle) =>
        vehicle.player
          ? {
              ...vehicle,
              z: 0.2,
              verticalVelocity: -22,
              grounded: false,
              contactLoad: 0,
            }
          : vehicle,
      ),
    }

    const stepped = stepRace(
      landing,
      { steering: 0, throttle: 0, braking: false },
      0.05,
      { next: () => 0.5 },
    )

    expect(stepped.state.cameraHints.shake).toBeGreaterThan(0)
    expect(stepped.state.cameraHints.shake).toBeLessThanOrEqual(6)
  })

  it('ranks finishers first and preserves grid order through ties', () => {
    const race = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const vehicles = race.vehicles.map((vehicle, index) => ({
      ...vehicle,
      lap: index === 2 ? 3 : 1,
      pathIndex: index === 0 || index === 1 ? 20 : 0,
      finishedAt: index === 2 ? 10 : null,
    }))

    expect(rankVehicles(vehicles, path.points.length).map(({ id }) => id))
      .toEqual(['ai-2', 'player', 'ai-1', 'ai-3'])
  })

  it('preserves the physical starting grid in both directions', () => {
    for (const [startRatio, reversed] of [[0, false], [0.35, false], [0.35, true]] as const) {
      const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 3, startRatio, reversed })
      expect(rankVehicles(race.vehicles, path.points.length, race.startPathIndex, reversed).map(({ id }) => id))
        .toEqual(race.vehicles.map(({ id }) => id))
    }
  })

  it('orders grid cars around the first crossing and the relocated seam in both directions', () => {
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    const [first, second] = race.vehicles.map(required)
    const length = path.points.length
    if (!first || !second) throw new Error('Missing grid cars')
    for (const [start, reversed] of [[0, false], [1, false], [length - 2, true]] as const) {
      const indexAt = (offset: number) => (start + (reversed ? -offset : offset) + length) % length
      const behind = { ...first, pathIndex: indexAt(-2) }
      const crossed = updateProgress({ ...second, pathIndex: indexAt(-1) }, indexAt(1), length, 1, 3, start, reversed)
      expect(crossed.lap).toBe(0)
      expect(rankVehicles([behind, crossed], length, start, reversed).map(({ id }) => id)).toEqual([second.id, first.id])
      const earlier = { ...first, pathIndex: indexAt(2) }
      const later = { ...second, pathIndex: indexAt(4) }
      expect(rankVehicles([earlier, later], length, start, reversed).map(({ id }) => id)).toEqual([second.id, first.id])
    }
  })

  it('orders finish times before progress and resolves equal finishes by grid order', () => {
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    const [first, second, third, fourth] = race.vehicles.map(required)
    if (!first || !second || !third || !fourth) throw new Error('Missing grid cars')
    const vehicles = [
      { ...first, finishedAt: 10, pathIndex: 0 },
      { ...second, finishedAt: 10, pathIndex: 5 },
      { ...third, finishedAt: 9 },
      { ...fourth, lap: 99 },
    ]
    expect(rankVehicles(vehicles, path.points.length).map(({ id }) => id)).toEqual([third.id, first.id, second.id, fourth.id])
  })

  it('lets parked cars gently separate without damage', () => {
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    const player = { ...required(race.vehicles[0]), x: 0, y: 0, vx: 0, vy: 0, speed: 0 }
    const rival = { ...required(race.vehicles[1]), x: 1, y: 0, vx: 0, vy: 0, speed: 0 }
    const frame = solveCollisionFrame([player, rival], [], 1 / 60)
    expect(frame.vehicles[0]?.damage).toBe(0)
    expect(frame.events).toEqual([])
    expect(frame.vehicles[0]?.x).toBeLessThan(player.x)
  })

  it('separates overlapping cars and applies bounded damage', () => {
    const race = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const [first, second] = race.vehicles
    const collided = solveCollisions([
      { ...required(first), x: 0, y: 0, speed: 100 },
      { ...required(second), x: 1, y: 0, speed: 20 },
    ])
    const collidedFirst = required(collided[0])
    const collidedSecond = required(collided[1])

    expect(Math.abs(collidedFirst.x - collidedSecond.x)).toBeGreaterThan(10)
    expect(collidedFirst.damage + collidedSecond.damage).toBeGreaterThan(0)
  })

  it.each([false, true])(
    'removes a finished opponent from contact without removing its standing (opponent first: %s)',
    (opponentFirst) => {
      const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 3 })
      const player = { ...required(race.vehicles[0]), x: 0, y: 0, vx: 100, speed: 100 }
      const rival = { ...required(race.vehicles[1]), x: 1, y: 0, vx: 0, speed: 0, finishedAt: 0, lap: 3 }
      const pair = opponentFirst ? [rival, player] : [player, rival]
      const previousContact = opponentFirst ? `${rival.id}:${player.id}` : `${player.id}:${rival.id}`

      const frame = solveCollisionFrame(pair, [], 0)
      const held = solveCollisionFrame(pair, [previousContact], 0)

      expect(frame.vehicles).toEqual(pair)
      expect(frame.activeContacts).toEqual([])
      expect(frame.events).toEqual([])
      expect(held.vehicles).toEqual(pair)
      expect(held.activeContacts).toEqual([])
      expect(rankVehicles(frame.vehicles, path.points.length)[0]).toEqual(rival)
    },
  )

  it('continues to collide with an unfinished opponent', () => {
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    const player = { ...required(race.vehicles[0]), x: 0, y: 0, vx: 100, speed: 100 }
    const rival = { ...required(race.vehicles[1]), x: 1, y: 0, vx: 0, speed: 0 }

    const frame = solveCollisionFrame([player, rival], [], 0)

    expect(frame.vehicles[0]).toMatchObject({ damage: 1 })
    expect(frame.vehicles[0]?.x).toBeLessThan(player.x)
    expect(frame.vehicles[0]?.vx).toBeLessThan(player.vx)
    expect(frame.vehicles[1]?.x).toBeGreaterThan(rival.x)
    expect(frame.activeContacts).toEqual([`${player.id}:${rival.id}`])
    expect(frame.events).toHaveLength(1)
  })

  it('keeps an earlier finisher in the running race and standings without affecting the player', () => {
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    const player = required(race.vehicles[0])
    const rival = { ...required(race.vehicles[1]), x: player.x + 1, y: player.y, z: player.z, finishedAt: 12, lap: 3 }
    const running = { ...race, phase: 'running' as const, vehicles: [player, rival], activeContacts: [`${player.id}:${rival.id}`] }
    const withoutRival = { ...running, vehicles: [player], activeContacts: [] }
    const input = { steering: 0, throttle: 1, braking: false }

    const observed = stepRace(running, input, 0.05, { next: () => 0.5 })
    const clear = stepRace(withoutRival, input, 0.05, { next: () => 0.5 })

    expect(observed.state.phase).toBe('running')
    expect(observed.state.vehicles[0]).toEqual(clear.state.vehicles[0])
    expect(observed.state.vehicles[1]).toMatchObject({ id: rival.id, finishedAt: 12, lap: 3 })
    expect(observed.state.activeContacts).toEqual([])
    expect(observed.events.filter(({ type }) => type === 'collision' || type === 'vehicle-finished')).toEqual([])
    expect(rankVehicles(observed.state.vehicles, path.points.length)[0]).toMatchObject({ id: rival.id, finishedAt: 12 })
  })

  it('removes an opponent from contact on the frame it finishes', () => {
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1 })
    const point = required(path.points[0])
    const player = { ...required(race.vehicles[0]), x: point.x, y: point.y, z: 0, pathIndex: 0 }
    const rival = {
      ...required(race.vehicles[1]),
      x: point.x - 1,
      y: point.y,
      z: 0,
      pathIndex: path.points.length - 2,
      nextSector: 4 as const,
      vx: 0,
      vy: 0,
      speed: 0,
    }
    const running = { ...race, phase: 'running' as const, elapsed: 12, vehicles: [player, rival] }
    const input = { steering: 0, throttle: 0, braking: false }

    const observed = stepRace(running, input, 0.001, { next: () => 0.5 })
    const clear = stepRace({ ...running, vehicles: [player] }, input, 0.001, { next: () => 0.5 })

    expect(observed.state.vehicles[0]).toEqual(clear.state.vehicles[0])
    expect(observed.state.vehicles[1]).toMatchObject({ id: rival.id, lap: 1, finishedAt: 12.001 })
    expect(observed.events).toContainEqual({ type: 'vehicle-finished', vehicleId: rival.id, time: 12.001 })
    expect(observed.events.some(({ type }) => type === 'collision')).toBe(false)
    expect(observed.state.phase).toBe('running')
  })

  it('does not collide cars travelling on different crossing levels', () => {
    const race = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const lower = {
      ...required(race.vehicles[0]),
      x: 0,
      y: 0,
      z: 0,
    }
    const upper = {
      ...required(race.vehicles[1]),
      x: 0,
      y: 0,
      z: WORLD_ELEVATION.levelHeight,
      grounded: false,
    }

    const frame = solveCollisionFrame([lower, upper], [], 0.016)

    expect(frame.events).toEqual([])
    expect(frame.vehicles.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ])
  })

  it('allows an airborne vehicle above the wall to leave a bridge', () => {
    const bridgePath = buildRoadPath(
      [
        {
          id: 'bridge',
          x: 0,
          y: 0,
          surface: 'street',
          structure: 'overpass',
        },
        { id: 'landing', x: 500, y: 0, surface: 'street' },
        { id: 'end', x: 900, y: 0, surface: 'street' },
      ],
      EMPTY_TERRAIN,
    )
    const deckIndex = bridgePath.points.findIndex(
      (point) => point.distance >= 240,
    )
    const center = required(bridgePath.points[deckIndex])
    const airborne = {
      ...required(
        createRace({
          path,
          playerCar: 'blue',
          difficulty: 'normal',
          laps: 3,
        }).vehicles[0],
      ),
      x: center.x,
      y: center.y,
      pathIndex: deckIndex,
      z:
        WORLD_ELEVATION.levelHeight +
        VERTICAL_DYNAMICS.bridgeWallHeight +
        0.1,
      grounded: false,
      contactLoad: 0,
    }
    const moved = {
      ...airborne,
      y: center.y + 52,
      vy: 80,
      speed: 80,
    }

    const frame = solveBridgeBarrierFrame(
      [airborne],
      [moved],
      bridgePath,
      [],
    )

    expect(frame.vehicles[0]).toMatchObject({
      y: moved.y,
      vy: moved.vy,
      speed: moved.speed,
    })
    expect(frame.events).toEqual([])
  })

  it('keeps a vehicle inside a long elevated road section', () => {
    const bridgePath = buildRoadPath(
      [
        {
          id: 'bridge',
          x: 0,
          y: 0,
          surface: 'street',
          structure: 'overpass',
        },
        { id: 'landing', x: 500, y: 0, surface: 'street' },
        { id: 'end', x: 900, y: 0, surface: 'street' },
      ],
      EMPTY_TERRAIN,
    )
    const deckIndex = bridgePath.points.findIndex(
      (point) => point.distance >= 240,
    )
    const center = required(bridgePath.points[deckIndex])
    const vehicle = {
      ...required(
        createRace({
          path,
          playerCar: 'blue',
          difficulty: 'normal',
          laps: 3,
        }).vehicles[0],
      ),
      x: center.x,
      y: center.y,
      pathIndex: deckIndex,
    }
    const frame = solveBridgeBarrierFrame(
      [vehicle],
      [{ ...vehicle, y: center.y + 52, vy: 80, speed: 80 }],
      bridgePath,
      [],
    )

    expect(frame.vehicles[0]?.y).toBeLessThan(center.y + 36)
    expect(frame.vehicles[0]?.speed).toBeLessThan(80)
    expect(frame.events).toHaveLength(1)
  })

  it('keeps the bridge barrier continuous at an all-overpass loop seam', () => {
    const bridgePath = buildRoadPath(
      [
        { id: 'a', x: 0, y: 0, surface: 'street', structure: 'overpass' },
        { id: 'b', x: 300, y: 0, surface: 'street', structure: 'overpass' },
        { id: 'c', x: 300, y: 300, surface: 'street', structure: 'overpass' },
        { id: 'd', x: 0, y: 300, surface: 'street', structure: 'overpass' },
        {
          id: 'a-close',
          x: 0,
          y: 0,
          surface: 'street',
          structure: 'overpass',
        },
      ],
      EMPTY_TERRAIN,
    )
    const center = required(bridgePath.points[0])
    const vehicle = {
      ...required(
        createRace({
          path: bridgePath,
          playerCar: 'blue',
          difficulty: 'normal',
          laps: 3,
        }).vehicles[0],
      ),
      x: center.x,
      y: center.y,
      pathIndex: 0,
      z: WORLD_ELEVATION.levelHeight,
      grounded: true,
    }
    const frame = solveBridgeBarrierFrame(
      [vehicle],
      [{ ...vehicle, y: center.y + 100, vy: 80, speed: 80 }],
      bridgePath,
      [],
    )

    expect(frame.events).toHaveLength(1)
    expect(frame.activeContacts[0]).toContain(
      bridgePath.roadSurface.at(0).structureRunId,
    )
  })

  it('damages only the player once per contact and honors cooldown', () => {
    const race = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const player = {
      ...required(race.vehicles[0]),
      x: 0,
      y: 0,
      vx: 100,
      speed: 100,
    }
    const ai = {
      ...required(race.vehicles[1]),
      x: 1,
      y: 0,
      vx: 0,
      speed: 0,
    }
    const first = solveCollisionFrame([player, ai], [], 0.1)
    expect(first.vehicles[0]).toMatchObject({
      damage: 1,
      damageCooldown: 0.55,
    })
    expect(first.vehicles[1]?.damage).toBe(0)
    expect(first.events).toHaveLength(1)

    const held = solveCollisionFrame(
      first.vehicles.map((vehicle) => ({ ...vehicle, x: vehicle.player ? 0 : 1 })),
      first.activeContacts,
      1,
    )
    expect(held.vehicles[0]?.damage).toBe(1)
    expect(held.events).toHaveLength(0)

    const distinct = solveCollisionFrame(
      held.vehicles.map((vehicle) => ({
        ...vehicle,
        x: vehicle.player ? 0 : 1,
        vx: vehicle.player ? 100 : 0,
        speed: vehicle.player ? 100 : 0,
      })),
      [],
      0,
    )
    expect(distinct.vehicles[0]?.damage).toBe(2)
  })
})
