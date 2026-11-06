import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
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
