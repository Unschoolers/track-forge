import { readFileSync } from 'node:fs'
import { assert, describe, expect, it } from 'vitest'
import { CAR_IDS } from '@/domain/model'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { decodeTrack } from '@/domain/track/trackCodec'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { requireFixture } from '../fixtures/requireFixture'

const path = buildRoadPath([
  { x: -600, y: 0, surface: 'street', curve: 'corner' },
  { x: 0, y: 0, surface: 'street', curve: 'corner', structure: 'overpass' },
  { x: 1800, y: 0, surface: 'street', curve: 'corner' },
  { x: 2400, y: 0, surface: 'street', curve: 'corner' },
], EMPTY_TERRAIN)

describe('driving onto a raised road', () => {
  it.each([false, true])('climbs the Figure-eight ramp before a single real jump (reverse=%s)', (reversed) => {
    const raw = JSON.parse(readFileSync('tests/fixtures/figureEight.trackforge.json', 'utf8'))
    const { path } = buildTrackGeometry(requireFixture(decodeTrack(raw, 1)))
    const direction = reversed ? -1 : 1
    const entrance = path.points.findIndex((_, index) =>
      path.roadSurface.at(index).structureRunId !== null &&
      path.roadSurface.at(index - direction).structureRunId === null,
    )
    const startIndex = entrance - 12 * direction
    const start = requireFixture(path.points[startIndex])
    const next = requireFixture(path.points[startIndex + direction])
    const angle = Math.atan2(next.y - start.y, next.x - start.x)
    const speed = 190
    const base = createRace({ path, playerCar: 'blue', difficulty: 'hard', laps: 2, reversed, handling: 'arcade' })
    let race: RaceState = {
      ...base,
      phase: 'running',
      vehicles: [{
        ...requireFixture(base.vehicles[0]),
        x: start.x,
        y: start.y,
        z: path.roadSurface.at(startIndex).height,
        pathIndex: startIndex,
        angle,
        speed,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        grounded: true,
        structureRunId: null,
      }],
    }
    let launches = 0
    let landings = 0
    let airborneFrames = 0
    let reachedDeck = false
    for (let frame = 0; frame < 110; frame++) {
      const car = requireFixture(race.vehicles[0])
      const target = requireFixture(path.points[car.pathIndex + 7 * direction])
      const error = Math.atan2(target.y - car.y, target.x - car.x) - car.angle
      const steering = Math.max(-1, Math.min(1, Math.atan2(Math.sin(error), Math.cos(error)) * 4))
      const step = stepRace(race, { steering, throttle: 0.8, braking: false }, 1 / 60, { next: () => 0.5 })
      race = step.state
      const updated = requireFixture(race.vehicles[0])
      const surface = path.roadSurface.at(updated.pathIndex, updated)
      if (!updated.grounded) {
        airborneFrames++
        if (car.grounded) {
          launches++
          expect(updated.z).toBeGreaterThan(surface.height + 0.01)
        }
      }
      landings += step.events.filter(({ type }) => type === 'vehicle-landed').length
      if ((updated.pathIndex - entrance) * direction > 42) {
        reachedDeck = true
        break
      }
    }
    expect(reachedDeck).toBe(true)
    expect(launches).toBe(1)
    expect(airborneFrames).toBeGreaterThan(5)
    expect(landings).toBe(1)
  })

  it.each([1, -1])('samples a continuous height and grade on the ramp (direction=%s)', (direction) => {
    const samples = path.points
    const entrance = samples.findIndex((_, index) =>
      path.roadSurface.at(index).structureRunId !== null &&
      path.roadSurface.at(index - direction).structureRunId === null,
    )
    expect(entrance).toBeGreaterThan(6)

    for (let offset = -2; offset < 10; offset++) {
      const index = entrance + offset * direction
      const start = samples[index]
      const end = samples[index + direction]
      assert(start && end, 'Missing ramp samples')
      const at = (ratio: number) => getVehicleStepContext(path, {
        x: start.x + (end.x - start.x) * ratio,
        y: 0,
        z: path.roadSurface.at(index).height,
        pathIndex: index,
        grounded: true,
      })
      const before = at(0.49)
      const after = at(0.51)
      expect(before.nearest.index).not.toBe(after.nearest.index)
      expect(after.surfaceHeight - before.surfaceHeight).toBeGreaterThanOrEqual(0)
      expect(after.surfaceHeight - before.surfaceHeight).toBeLessThan(0.06)
      expect(Math.abs(after.grade - before.grade)).toBeLessThan(0.004)
    }
  })

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
