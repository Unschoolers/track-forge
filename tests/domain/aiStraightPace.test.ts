// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { DifficultyId, SurfaceId } from '@/domain/model'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import { stepRace } from '@/domain/race/raceEngine'
import { createRace } from '@/domain/race/raceFactory'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath, type RoadPath } from '@/domain/track/pathBuilder'
import { requireFixture } from '../fixtures/requireFixture'

const fullThrottle = { steering: 0, throttle: 1, braking: false }
const random = { next: () => 0.5 }

function straightCircuit(surface: SurfaceId) {
  return buildRoadPath([
    { x: 0, y: 0, surface, curve: 'corner' },
    { x: 3_600, y: 0, surface, curve: 'corner' },
    { x: 3_600, y: 1_000, surface, curve: 'corner' },
    { x: 0, y: 1_000, surface, curve: 'corner' },
    { x: 0, y: 0, surface, curve: 'corner' },
  ], EMPTY_TERRAIN)
}

function onStraight(
  race: RaceState, vehicle: RaceVehicle, distance: number, lane: number, speed: number,
): RaceVehicle {
  const pathIndex = race.path.points.findIndex((point) => point.distance >= distance)
  const point = requireFixture(race.path.points[pathIndex])
  return {
    ...vehicle,
    car: requireFixture(race.vehicles[0]).car,
    x: point.x,
    y: point.y + lane,
    angle: race.reversed ? Math.PI : 0,
    speed,
    vx: race.reversed ? -speed : speed,
    lane,
    ai: vehicle.player ? null : createAiDriverState(lane),
    pathIndex,
    pathDistance: point.distance,
    currentSurface: point.surface,
  }
}

function run(race: RaceState, frames: number) {
  let current = race
  for (let frame = 0; frame < frames; frame += 1) {
    current = stepRace(current, fullThrottle, 1 / 60, random).state
  }
  return current.vehicles
}

describe('straight-line rival pace', () => {
  const configurations = [
    ['easy', 'arcade', 'street'],
    ['normal', 'arcade', 'street'],
    ['hard', 'arcade', 'street'],
    ['hard', 'simulation', 'street'],
    ['easy', 'simulation', 'ice'],
    ['hard', 'arcade', 'dirt'],
  ] as const satisfies ReadonlyArray<readonly [DifficultyId, RaceState['handling'], SurfaceId]>

  it.each(configurations)('matches the player in the same car on %s / %s / %s',
    (difficulty, handling, surface) => {
      const path = straightCircuit(surface)
      const race = createRace({ path, difficulty, handling, playerCar: 'red', laps: 1 })
      const [player, rival] = race.vehicles
      const sideBySide: RaceState = {
        ...race, phase: 'running',
        vehicles: [
          onStraight(race, requireFixture(player), 650, -20, 0),
          onStraight(race, requireFixture(rival), 650, 20, 0),
        ],
      }
      for (const frames of [30, 360]) {
        const [driven, ai] = run(sideBySide, frames)
        expect(requireFixture(driven).speed).toBeGreaterThan(18)
        expect(requireFixture(ai).speed).toBeCloseTo(requireFixture(driven).speed, 3)
      }
    },
  )
})

describe('rival catch-up', () => {
  const path: RoadPath = straightCircuit('street')

  function arranged(reversed = false, otherDistance = 700, playerSpeed = 300): RaceState {
    const race = createRace({
      path, reversed, difficulty: 'hard', handling: 'arcade', playerCar: 'blue', laps: 2,
      startRatio: 1_040 / path.totalLength,
    })
    const [player, rival, other] = race.vehicles
    const distance = (forwardDistance: number) => reversed ? 2_080 - forwardDistance : forwardDistance
    return {
      ...race, phase: 'running',
      vehicles: [
        onStraight(race, requireFixture(player), distance(1_300), -20, playerSpeed),
        onStraight(race, requireFixture(rival), distance(900), 20, 300),
        onStraight(race, requireFixture(other), distance(otherDistance), 0, 300),
      ],
    }
  }

  it.each([false, true])('helps distant trailing rivals with the same 12%% cap in reverse=%s',
    (reversed) => {
      const [player, rival] = run(arranged(reversed), 90)
      expect(requireFixture(rival).speed).toBeGreaterThan(requireFixture(player).speed + 3)
      expect(requireFixture(rival).speed).toBeLessThanOrEqual(requireFixture(player).speed * 1.12)
    },
  )

  it('boosts each trailing rival independently of the other rivals', () => {
    const farBehind = arranged()
    const withOtherCloser = arranged(false, 1_166)
    const withOtherAhead = arranged(false, 1_600)
    const priorFinisher = {
      ...farBehind,
      vehicles: farBehind.vehicles.map((vehicle) =>
        vehicle.id === 'ai-2' ? { ...vehicle, finishedAt: 0 } : vehicle),
    }
    const ordinary = { ...farBehind, vehicles: farBehind.vehicles.slice(1) }
    const stockSpeed = requireFixture(run(ordinary, 1)[0]).speed
    const assistedSpeed = requireFixture(run(farBehind, 1)[1]).speed
    expect(assistedSpeed).toBeGreaterThan(stockSpeed)
    // An opponent no longer cancels or changes another opponent's boost.
    for (const race of [withOtherCloser, withOtherAhead, priorFinisher]) {
      expect(requireFixture(run(race, 1)[1]).speed).toBeCloseTo(assistedSpeed, 5)
    }
    const almostCaught = {
      ...farBehind,
      vehicles: farBehind.vehicles.map((vehicle) =>
        vehicle.id === 'ai-1' ? onStraight(farBehind, vehicle, 1_270, 20, 300) : vehicle),
    }
    expect(requireFixture(run(almostCaught, 1)[1]).speed).toBeCloseTo(stockSpeed, 5)
  })
})
