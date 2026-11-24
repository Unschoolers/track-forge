import { requireFixture } from '../fixtures/requireFixture'
import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { updateProgress } from '@/domain/race/progress'
import { resolveRecoveryCheckpoints } from '@/domain/track/recoveryCheckpoints'
import { stepPlayer } from '@/domain/race/vehiclePhysics'
import { stepRace } from '@/domain/race/raceEngine'
import { rankVehicles } from '@/domain/race/ranking'

const track = createStarterTrack(asTrackId('starter'), 1)
const path = buildRoadPath(track.points, track.terrain)
const authoredGates = resolveRecoveryCheckpoints(path, track.recoveryCheckpoints)

describe('race simulation', () => {
  it('creates a deterministic four-car starting grid', () => {
    const first = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
      path,
      playerCar: 'green',
      difficulty: 'hard',
      laps: 3,
    })
    const second = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
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
      z: 0,
      verticalVelocity: 0,
      grounded: true,
      contactLoad: 1,
    })
    expect(second).toEqual(first)
  })

  it('accelerates, steers, and brakes according to car and surface tuning', () => {
    const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
      path,
      playerCar: 'red',
      difficulty: 'normal',
      laps: 3,
    })
    const player = requireFixture(race.vehicles[0])
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
    const vehicle = requireFixture(
      createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
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
    const finished = updateProgress(nearEnd, 2, path.points.length, 12.5, 1, 0, false, authoredGates)

    expect(finished).toMatchObject({ lap: 1, finishedAt: 12.5 })
  })

  it('does not count a backward start-line wrap', () => {
    const vehicle = requireFixture(
      createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
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
        0,
        false,
        authoredGates,
      ),
    ).toMatchObject({ lap: 1, finishedAt: null })
  })

  it('rejects a shortcut across the start line before all sectors', () => {
    const vehicle = requireFixture(
      createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
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
      0,
      false,
      authoredGates,
    )

    expect(shortcut).toMatchObject({
      lap: 0,
      nextSector: 2,
      finishedAt: null,
    })
  })

  it('updates every vehicle from its post-movement nearest path point', () => {
    const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const displaced = {
      ...race,
      phase: 'running' as const,
      vehicles: race.vehicles.map((vehicle, index) => {
        const pointIndex = 40 + index * 10
        const point = requireFixture(path.points[pointIndex])
        // Local projection lag, not a teleport across an unpassed gate.
        const nextSector = (race.timingGates ?? []).filter(gate => gate < pointIndex).length + 1
        return { ...vehicle, x: point.x, y: point.y, pathIndex: pointIndex - 3, nextSector }
      }),
    }

    const stepped = stepRace(
      displaced,
      { steering: 0, throttle: 0, braking: false },
      0.001,
      { next: () => 0.5 },
    )

    expect(stepped.state.vehicles.map(vehicle => vehicle.pathIndex)).toEqual([40, 50, 60, 70])
    expect(stepped.events.some(event => event.type === 'vehicle-recovered')).toBe(false)
  })

  it('applies vertical gravity to player and AI vehicles in one common pass', () => {
    const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
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
    const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
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
    const burst = stepped.state.effects.particles.filter(({ kind }) => kind === 'landing-dust')
    expect(burst).toHaveLength(4)
    const next = stepRace(
      stepped.state,
      { steering: 0, throttle: 0, braking: false },
      1 / 60,
      { next: () => 0.5 },
    )
    expect(next.events.some(({ type }) => type === 'vehicle-landed')).toBe(false)
    expect(next.state.effects.particles.filter(({ kind }) => kind === 'landing-dust')).toHaveLength(4)
  })

  it('ranks finishers first and preserves grid order through ties', () => {
    const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75],
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
      const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75], path, playerCar: 'blue', difficulty: 'normal', laps: 3, startRatio, reversed })
      expect(rankVehicles(race.vehicles, path.points.length, race.startPathIndex, reversed).map(({ id }) => id))
        .toEqual(race.vehicles.map(({ id }) => id))
    }
  })

  it('orders grid cars around the first crossing and the relocated seam in both directions', () => {
    const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75], path, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    const [first, second] = race.vehicles.map(requireFixture)
    const length = path.points.length
    if (!first || !second) throw new Error('Missing grid cars')
    for (const [start, reversed] of [[0, false], [1, false], [length - 2, true]] as const) {
      const indexAt = (offset: number) => (start + (reversed ? -offset : offset) + length) % length
      const behind = { ...first, pathIndex: indexAt(-2) }
      const crossed = updateProgress({ ...second, pathIndex: indexAt(-1) }, indexAt(1), length, 1, 3, start, reversed, authoredGates)
      expect(crossed.lap).toBe(0)
      expect(rankVehicles([behind, crossed], length, start, reversed).map(({ id }) => id)).toEqual([second.id, first.id])
      const earlier = { ...first, pathIndex: indexAt(2) }
      const later = { ...second, pathIndex: indexAt(4) }
      expect(rankVehicles([earlier, later], length, start, reversed).map(({ id }) => id)).toEqual([second.id, first.id])
    }
  })

  it('orders finish times before progress and resolves equal finishes by grid order', () => {
    const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75], path, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    const [first, second, third, fourth] = race.vehicles.map(requireFixture)
    if (!first || !second || !third || !fourth) throw new Error('Missing grid cars')
    const vehicles = [
      { ...first, finishedAt: 10, pathIndex: 0 },
      { ...second, finishedAt: 10, pathIndex: 5 },
      { ...third, finishedAt: 9 },
      { ...fourth, lap: 99 },
    ]
    expect(rankVehicles(vehicles, path.points.length).map(({ id }) => id)).toEqual([third.id, first.id, second.id, fourth.id])
  })

  it('keeps an earlier finisher in the running race and standings without affecting the player', () => {
    const race = createRace({ recoveryCheckpoints: [0.25, 0.5, 0.75], path, playerCar: 'blue', difficulty: 'normal', laps: 3 })
    const player = requireFixture(race.vehicles[0])
    const rival = { ...requireFixture(race.vehicles[1]), x: player.x + 1, y: player.y, z: player.z, finishedAt: 12, lap: 3 }
    const running = { ...race, phase: 'running' as const, vehicles: [player, rival] }
    const withoutRival = { ...running, vehicles: [player] }
    const input = { steering: 0, throttle: 1, braking: false }

    const observed = stepRace(running, input, 0.05, { next: () => 0.5 })
    const clear = stepRace(withoutRival, input, 0.05, { next: () => 0.5 })

    expect(observed.state.phase).toBe('running')
    expect(observed.state.vehicles[0]).toEqual(clear.state.vehicles[0])
    expect(observed.state.vehicles[1]).toMatchObject({ id: rival.id, finishedAt: 12, lap: 3 })

    expect(observed.events.filter(({ type }) => type === 'vehicle-finished')).toEqual([])
    expect(rankVehicles(observed.state.vehicles, path.points.length)[0]).toMatchObject({ id: rival.id, finishedAt: 12 })
  })
})
