// @vitest-environment node
import { expect, it } from 'vitest'
import { CAR_IDS } from '@/domain/model'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import { stepRace, type RaceEvent } from '@/domain/race/raceEngine'
import { createRace } from '@/domain/race/raceFactory'
import type { RaceState } from '@/domain/race/raceState'
import { OFFICIAL_CIRCUITS, OFFICIAL_COURSES, RALLY_FINALE } from '@/domain/track/officialCircuits'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { validateTrack } from '@/domain/track/trackValidation'

it('includes a race-ready point-to-point finale in the official catalog', () => {
  const track = RALLY_FINALE
  const path = buildRoadPath(track.points, track.terrain, undefined, track.routeKind)
  expect(OFFICIAL_COURSES.map(entry => entry.track)).toContain(track)
  expect(OFFICIAL_CIRCUITS.map(entry => entry.track)).not.toContain(track)
  expect(validateTrack(track, path.totalLength).ready).toBe(true)
  expect(track.routeKind).toBe('point-to-point')
  expect(path.closed).toBe(false)
  expect(path.crossings).toHaveLength(0)
  const race = createRace({
    path, routeKind: 'point-to-point', recoveryCheckpoints: track.recoveryCheckpoints,
    playerCar: 'blue', difficulty: 'normal', laps: 1,
  })
  expect(race.timingGates).toHaveLength(4)
  expect(new Set(path.points.map(point => point.surface))).toEqual(new Set(['street', 'dirt']))
})

it('lets all four cars finish the one-run finale at normal Cup pace', () => {
  const track = RALLY_FINALE
  const path = buildRoadPath(track.points, track.terrain, undefined, track.routeKind)
  const grid = createRace({
    path, routeKind: 'point-to-point', recoveryCheckpoints: track.recoveryCheckpoints,
    playerCar: 'blue', difficulty: 'normal', laps: 1,
  })
  let race: RaceState = { ...grid, phase: 'running', countdown: 0,
    vehicles: grid.vehicles.map(vehicle => ({
      ...vehicle, player: false, ai: vehicle.ai ?? createAiDriverState(0),
    })) }
  const recoveries: RaceEvent[] = []
  for (let tick = 0; tick < 75 * 60 && race.vehicles.some(vehicle => vehicle.finishedAt === null); tick++) {
    const step = stepRace(race, { throttle: 0, braking: false, steering: 0 }, 1 / 60, { next: () => 0.5 })
    recoveries.push(...step.events.filter(event => event.type === 'vehicle-recovered'))
    race = step.state
  }
  expect(new Set(race.vehicles.map(vehicle => vehicle.car))).toEqual(new Set(CAR_IDS))
  for (const vehicle of race.vehicles) {
    expect(vehicle.finishedAt, vehicle.car).toBeGreaterThan(40)
    expect(vehicle.finishedAt, vehicle.car).toBeLessThan(75)
  }
  expect(recoveries).toEqual([])
})
