import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import type { RaceState } from '@/domain/race/raceState'

const track = createStarterTrack(asTrackId('ai-race'), 1)
const path = buildRoadPath(track.points, track.terrain)

describe('AI race integration', () => {
  it('creates persistent driver state, distinct pace, and a hard mirror rival', () => {
    const race = createRace({
      path,
      playerCar: 'green',
      difficulty: 'hard',
      laps: 3,
    })
    const ai = race.vehicles.filter((vehicle) => !vehicle.player)

    expect(ai.every((vehicle) => vehicle.ai !== null)).toBe(true)
    expect(ai[0]?.car).toBe('green')
    expect(new Set(ai.map((vehicle) => vehicle.aiPace)).size).toBe(3)
  })

  it('updates AI lanes and state deterministically in the race engine', () => {
    const race = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const player = race.vehicles[0]
    const ai = race.vehicles[1]
    if (!player || !ai) throw new Error('Missing race fixtures')
    const point = path.points[30]
    const ahead = path.points[36]
    if (!point || !ahead) throw new Error('Missing path fixtures')
    const arranged = {
      ...race,
      phase: 'running' as const,
      elapsed: 2,
      vehicles: race.vehicles.map((vehicle, index) =>
        index === 1
          ? {
              ...vehicle,
              x: point.x,
              y: point.y,
              pathIndex: 30,
              speed: 100,
              vx: Math.cos(vehicle.angle) * 100,
              vy: Math.sin(vehicle.angle) * 100,
            }
          : index === 2
            ? {
                ...vehicle,
                x: ahead.x,
                y: ahead.y,
                pathIndex: 36,
                speed: 20,
              }
            : vehicle,
      ),
    }

    const next = stepRace(
      arranged,
      { steering: 0, throttle: 1, braking: false },
      0.033,
      { next: () => 0.5 },
    ).state
    const steppedAi = next.vehicles[1]

    expect(steppedAi?.ai?.phase).toBe('passing')
    expect(steppedAi?.ai?.targetLane).not.toBe(steppedAi?.ai?.baseLane)
    expect(Number.isFinite(steppedAi?.lane)).toBe(true)
  })

  it('keeps AI cars stable on the shared force model over time', () => {
    const created = createRace({
        path,
        playerCar: 'blue',
        difficulty: 'normal',
        laps: 3,
      })
    const player = created.vehicles[0]
    const ai = created.vehicles[1]
    if (!player || !ai) throw new Error('Missing long-run fixtures')
    let race: RaceState = {
      ...created,
      phase: 'running' as const,
      elapsed: 2,
      vehicles: [
        {
          ...player,
          x: 10_000,
          y: 10_000,
          wrecked: true,
        },
        ai,
      ],
    }

    const maximumDistance = new Map<string, number>()
    for (let frame = 0; frame < 600; frame += 1) {
      race = stepRace(
        race,
        { steering: 0, throttle: 0, braking: false },
        1 / 60,
        { next: () => 0.5 },
      ).state
      for (const ai of race.vehicles.filter((vehicle) => !vehicle.player)) {
        const distance = getVehicleStepContext(path, ai).nearest.distance
        maximumDistance.set(
          ai.id,
          Math.max(maximumDistance.get(ai.id) ?? 0, distance),
        )
      }
    }
    for (const ai of race.vehicles.filter((vehicle) => !vehicle.player)) {
      const context = getVehicleStepContext(path, ai)
      expect(context.nearest.distance).toBeLessThan(50)
      expect(maximumDistance.get(ai.id)).toBeLessThan(72)
      expect(Number.isFinite(ai.speed)).toBe(true)
      expect(Number.isFinite(ai.yawRate)).toBe(true)
    }
  })

  it('recovers opponents pushed beyond the drivable verge', () => {
    let race: RaceState = {
      ...createRace({
        path,
        playerCar: 'blue',
        difficulty: 'normal',
        laps: 3,
      }),
      phase: 'running' as const,
      elapsed: 2,
    }

    for (let frame = 0; frame < 600; frame += 1) {
      race = stepRace(
        race,
        { steering: 0, throttle: 0, braking: false },
        1 / 60,
        { next: () => 0.5 },
      ).state
    }

    for (const ai of race.vehicles.filter((vehicle) => !vehicle.player)) {
      expect(getVehicleStepContext(path, ai).nearest.distance).toBeLessThan(
        72,
      )
    }
  })
})
