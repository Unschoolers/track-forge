import { describe, expect, it } from 'vitest'
import { createRace } from '@/domain/race/raceFactory'
import { resetRaceVehicle, stepRace } from '@/domain/race/raceEngine'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { requireFixture } from '../fixtures/requireFixture'

const path = buildRoadPath([
  { x: 0, y: 16, surface: 'street' },
  { x: 1_200, y: 16, surface: 'street' },
], { cellSize: 32, cells: [{ column: 19, row: 0, kind: 'water' }] }, undefined, 'point-to-point')
const random = { next: () => 0.5 }
const coast = { throttle: 0, steering: 0, braking: false }

function running(
  handling: 'arcade' | 'simulation',
  recoveryScenery?: Parameters<typeof createRace>[0]['recoveryScenery'],
) {
  const initial = createRace({
    path, routeKind: 'point-to-point', playerCar: 'blue', difficulty: 'normal',
    handling, laps: 1, recoveryCheckpoints: [0.15, 0.4, 0.8], recoveryScenery,
  })
  const player = requireFixture(initial.vehicles[0])
  return { ...initial, phase: 'running' as const, vehicles: [player] }
}

function at(x: number, speed = 0) {
  const position = { x, y: 16 }
  const point = requireFixture(nearestPathPoint(path, position))
  return { ...position, pathIndex: point.index, pathDistance: point.point.distance, speed, vx: speed, vy: 0 }
}

describe('authored race recovery checkpoints', () => {
  it.each(['arcade', 'simulation'] as const)('uses the last driven checkpoint for water and manual recovery in %s', handling => {
    const race = running(handling)
    const player = { ...requireFixture(race.vehicles[0]), ...at(179, 100) }
    const passed = stepRace({ ...race, vehicles: [player] }, coast, 1 / 60, random).state
    const after = requireFixture(passed.vehicles[0])
    const fartherAlong = { ...after, ...at(450), nextSector: 2 as const }
    expect(resetRaceVehicle(fartherAlong, passed).x).toBeCloseTo(180)

    const incident = stepRace({ ...passed, elapsed: 9, vehicles: [{ ...fartherAlong, ...at(610) }] }, coast, 1 / 60, random)
    expect(incident.state.phase).toBe('running')
    expect(incident.state.elapsed).toBeGreaterThan(9)
    expect(incident.state.vehicles[0]).toMatchObject({ x: 180, speed: 0, nextSector: 2 })
    expect(incident.events.filter(event => event.type === 'vehicle-recovered')).toHaveLength(1)
  })

  it('recovers at Start until the player passes a checkpoint', () => {
    const race = running('simulation')
    const player = { ...requireFixture(race.vehicles[0]), ...at(610) }
    const recovered = stepRace({ ...race, vehicles: [player] }, coast, 1 / 60, random)
    expect(recovered.state.vehicles[0]).toMatchObject({ x: 0, nextSector: 1, finishedAt: null })
    expect(recovered.state.phase).toBe('running')
  })

  it('returns a wrecked player to their checkpoint with a driveable car', () => {
    const race = running('simulation')
    const player = { ...requireFixture(race.vehicles[0]), ...at(179, 100) }
    const passed = stepRace({ ...race, vehicles: [player] }, coast, 1 / 60, random).state
    const after = requireFixture(passed.vehicles[0])
    const wrecked = { ...after, ...at(450), wrecked: true, damage: after.damageLimit }
    const recovered = stepRace({ ...passed, vehicles: [wrecked] }, coast, 1 / 60, random)
    expect(recovered.state.vehicles[0]).toMatchObject({ x: 180, wrecked: false, damage: 0 })
    expect(recovered.state.phase).toBe('running')
  })

  it('recovers after hitting visible scenery and ignores a hidden prop', () => {
    const scenery = [{ kind: 'desert-cactus' as const, x: 245, y: 16 }]
    for (const environmentId of ['desert', 'cityscape'] as const) {
      const race = running('arcade', { environmentId, trees: [], scenery })
      const player = { ...requireFixture(race.vehicles[0]), ...at(179, 100) }
      const passed = stepRace({ ...race, vehicles: [player] }, coast, 1 / 60, random).state
      const approaching = { ...requireFixture(passed.vehicles[0]), ...at(229, 100) }
      const impact = stepRace({ ...passed, vehicles: [approaching] }, coast, 1 / 30, random)
      if (environmentId === 'desert') {
        expect(impact.state.vehicles[0]?.x).toBe(180)
        expect(impact.events).toContainEqual(expect.objectContaining({ type: 'vehicle-recovered', reason: 'scenery' }))
      } else {
        expect(impact.state.vehicles[0]?.x).toBeGreaterThan(229)
      }
    }
  })
})
