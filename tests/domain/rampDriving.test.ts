import { describe, expect, it } from 'vitest'
import { CAR_IDS } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'

const path = buildRoadPath([
  { x: -600, y: 0, surface: 'street', curve: 'corner' },
  { x: 0, y: 0, surface: 'street', curve: 'corner', structure: 'overpass' },
  { x: 1800, y: 0, surface: 'street', curve: 'corner' },
  { x: 2400, y: 0, surface: 'street', curve: 'corner' },
], EMPTY_TERRAIN)

describe('driving onto a raised road', () => {
  for (const reversed of [false, true]) {
    for (const car of CAR_IDS) {
      it.each([1 / 120, 1 / 60, 1 / 30, 0.05])(
        `keeps ${car} on top through the ramp and landing (reverse=${reversed}, dt=%s)`,
        (dt) => {
          const base = createRace({
            path, playerCar: car, difficulty: 'normal', laps: 2,
            reversed, handling: 'arcade',
          })
          const player = base.vehicles[0]
          if (!player) throw new Error('Missing player')
          const x = reversed ? 1950 : -150
          let race: RaceState = {
            ...base,
            phase: 'running' as const,
            vehicles: [{
              ...player, x, y: 0, angle: reversed ? Math.PI : 0,
              vx: reversed ? -150 : 150, vy: 0, speed: 150,
              pathIndex: nearestPathPoint(path, { x, y: 0 })?.index ?? 0,
            }],
          }
          let rampFrames = 0
          let deckFrames = 0
          let minimumClearance = Number.POSITIVE_INFINITY
          for (let frame = 0; frame < 8 / dt; frame++) {
            race = stepRace(race, { steering: 0, throttle: 1, braking: false },
              dt, { next: () => 0.5 }).state
            const vehicle = race.vehicles[0]
            if (!vehicle) throw new Error('Player disappeared')
            const context = getVehicleStepContext(path, vehicle)
            const road = path.roadSurface.at(context.nearest.index, vehicle)
            if (road.structureHeight <= 0.005) continue
            if (road.structureHeight < 23.99) rampFrames++
            else deckFrames++
            minimumClearance = Math.min(minimumClearance, vehicle.z - road.height)
          }
          expect(rampFrames).toBeGreaterThan(2)
          expect(deckFrames).toBeGreaterThan(10)
          expect(minimumClearance, 'A car entering from the ramp must never fall under its deck')
            .toBeGreaterThanOrEqual(-0.01)
        },
      )
    }
  }

  it.each([false, true])('keeps AI traffic above its ramp (reverse=%s)', (reversed) => {
    const base = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2, reversed })
    const x = reversed ? 1950 : -150
    let race: RaceState = {
      ...base, phase: 'running',
      vehicles: base.vehicles.slice(1).map((vehicle, index) => ({
        ...vehicle, x: x + (reversed ? 1 : -1) * index * 55, y: 0,
        angle: reversed ? Math.PI : 0, vx: reversed ? -150 : 150,
        vy: 0, speed: 150, pathIndex: nearestPathPoint(path, { x, y: 0 })?.index ?? 0,
      })),
    }
    for (let frame = 0; frame < 480; frame++) {
      race = stepRace(race, { steering: 0, throttle: 1, braking: false },
        1 / 60, { next: () => 0.5 }).state
      for (const vehicle of race.vehicles) {
        const context = getVehicleStepContext(path, vehicle)
        const road = path.roadSurface.at(context.nearest.index, vehicle)
        expect(vehicle.z - road.height, `${vehicle.car} frame ${frame}`)
          .toBeGreaterThanOrEqual(-0.01)
      }
    }
  })
})
