// @vitest-environment node
// Desert sand: real player-exported reverse circuit, anonymized geometry.
// Keep identical seeds / starts / mode when comparing AI pace revisions.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'
import type { CarId, DifficultyId } from '@/domain/model'
import { CAR_DRIVING_PROFILES, type CarDrivingProfile } from '@/domain/race/ai/aiCarDrivingProfiles'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'

function loadTrack() {
  const [decoded] = decodeTrackInput(JSON.parse(
    readFileSync('tests/fixtures/desertSandAi.trackforge.json', 'utf8'),
  ))
  if (!decoded) throw new Error('Missing Desert sand fixture')
  return decoded
}
const track = loadTrack()
const path = prepareLanePath(track)
const cars = ['red', 'green', 'blue', 'yellow'] as const
const difficulties = ['hard', 'normal'] as const
const gridPositions = [1, 3, 0, 2] as const

function drive(car: CarId, difficulty: DifficultyId, seed: number, mode: 'solo' | 'traffic') {
  const run = runLaneCheck({
    path, trackName: track.name, seed, car, difficulty,
    reversed: true, handling: 'arcade', mode,
    gridPositions, startRatio: track.start?.ratio ?? 0,
    laps: 2, seconds: 90,
  })
  return {
    seed, car, difficulty, mode,
    results: run.vehicles.map(vehicle => ({
      car: vehicle.car,
      time: vehicle.finishedAt,
      recoveries: vehicle.recoveries,
      offRoadSeconds: vehicle.offRoadSeconds,
    })),
    errors: run.issues.filter(issue => issue.severity === 'error').map(issue => issue.code),
  }
}

describe('Desert sand AI lap pace on a real reverse two-lap circuit', () => {
  it('records reproducible Hard-first solo and traffic pace without losing finishes', () => {
    const solo = difficulties.flatMap(difficulty => cars.map(car => drive(car, difficulty, 1, 'solo')))
    // One complete four-car race with the recorded grid: traffic can be a
    // larger influence than solo racing lines. Its player slot is AI-driven.
    const traffic = drive('green', 'normal', 1, 'traffic')
    console.log('DESERT_SAND_AI_PACE ' + JSON.stringify({ solo, traffic }))
    for (const row of [...solo, traffic]) {
      expect(row.results.every(vehicle => vehicle.time !== null),
        JSON.stringify(row)).toBe(true)
    }
  }, 120_000)
})



function measure(
  course: { path: typeof path, name: string, reversed: boolean, ratio: number, laps: number },
  car: CarId, difficulty: DifficultyId, mode: 'solo' | 'traffic', seed: number,
  overrides: Partial<Record<CarId, CarDrivingProfile>>,
) {
  const run = runLaneCheck({
    path: course.path, trackName: course.name, seed, car, difficulty,
    reversed: course.reversed, handling: 'arcade', mode,
    startRatio: course.ratio, laps: course.laps, seconds: 150,
    aiProfileOverrides: overrides,
  })
  return {
    track: course.name, car, mode, seed,
    vehicles: run.vehicles.map(vehicle => ({
      car: vehicle.car, time: vehicle.finishedAt,
      recoveries: vehicle.recoveries, offRoad: vehicle.offRoadSeconds,
    })),
    issues: run.issues.filter(issue => issue.severity === 'error').map(issue => issue.code),
  }
}

const desert = {
  path, name: track.name, reversed: true,
  ratio: track.start?.ratio ?? 0, laps: 2,
}
const [kidsRoom] = decodeTrackInput(JSON.parse(readFileSync(
  'tests/fixtures/kidsRoomAi.trackforge.json', 'utf8',
)))
if (!kidsRoom) throw new Error('Missing Kids room')
const pine = OFFICIAL_CIRCUITS.find(c => c.track.name === 'Pine Hairpins')
const meadow = OFFICIAL_CIRCUITS.find(c => c.track.name === 'Meadow Loop')
if (!pine || !meadow) throw new Error('Missing official circuits')
const courses = [
  { name: 'Kids room', path: prepareLanePath(kidsRoom), reversed: false, ratio: 0.21932299012693934, laps: 2 },
  { name: 'Pine Hairpins', path: prepareLanePath(pine.track), reversed: false, ratio: 0, laps: 1 },
  { name: 'Meadow Loop', path: prepareLanePath(meadow.track), reversed: false, ratio: 0, laps: 2 },
] as const

it('checks Green edge preview for speed and recoveries across real traffic and three other shapes', () => {
  const rows = [0.2, 0.4].flatMap(edge => {
    const profile: CarDrivingProfile = {
      ...CAR_DRIVING_PROFILES.green, hardEdgeAvoidanceScale: edge,
    }
    const overrides = { green: profile }
    return [
      { edge, ...measure(desert, 'green', 'hard', 'solo', 1, overrides) },
      { edge, ...measure(desert, 'green', 'hard', 'traffic', 1, overrides) },
      { edge, ...measure(courses[0], 'red', 'hard', 'traffic', 1, overrides) },
      ...courses.map(course => ({
        edge, ...measure(course, 'green', 'hard', 'solo', 1, overrides),
      })),
    ]
  })
  console.log(`GREEN_EDGE_CROSS_TRACK ${JSON.stringify(rows)}`)
  expect(rows).toHaveLength(12)
}, 180_000)

it('screens safe Yellow corner bonus levels on reverse Desert sand', () => {
  const rows = [0, 0.05, 0.1, 0.15, 0.2, 0.25].map(bonus => {
    const profile: CarDrivingProfile = {
      ...CAR_DRIVING_PROFILES.yellow, hardCornerTargetBonus: bonus,
    }
    return {
      bonus, ...measure(desert, 'yellow', 'hard', 'solo', 1, { yellow: profile }),
    }
  })
  console.log(`YELLOW_BONUS_SAFETY ${JSON.stringify(rows)}`)
  expect(rows).toHaveLength(6)
}, 180_000)

it('screens Blue corner pace tradeoff across Desert and Kids room', () => {
  const rows = [0.04, 0.08, 0.1, 0.12].flatMap(bonus => {
    const profile: CarDrivingProfile = {
      ...CAR_DRIVING_PROFILES.blue, hardCornerTargetBonus: bonus,
    }
    return [
      { bonus, ...measure(desert, 'blue', 'hard', 'solo', 1, { blue: profile }) },
      { bonus, ...measure(courses[0], 'blue', 'hard', 'solo', 1, { blue: profile }) },
    ]
  })
  console.log(`BLUE_CORNER_PACE_TRADEOFF ${JSON.stringify(rows)}`)
  expect(rows).toHaveLength(8)
}, 180_000)
