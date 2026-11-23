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


type Candidate = { readonly label: string, readonly changes: Partial<CarDrivingProfile> }
const candidates: Readonly<Partial<Record<CarId, readonly Candidate[]>>> = {
  green: [
    { label: 'base', changes: {} },
    { label: 'no-corner-bonus', changes: { hardCornerTargetBonus: 0 } },
    { label: 'edge0.2', changes: { hardEdgeAvoidanceScale: 0.2 } },
    { label: 'reserve0.07', changes: { hardCornerReserve: 0.07 } },
    { label: 'reaction8', changes: { hardReaction: 8 } },
    { label: 'gain2.7', changes: { hardSteerGain: 2.7 } },
  ],
  yellow: [
    { label: 'base', changes: {} },
    { label: 'no-corner-bonus', changes: { hardCornerTargetBonus: 0 } },
    { label: 'reaction8', changes: { hardReaction: 8 } },
    { label: 'gain2.5', changes: { hardSteerGain: 2.5 } },
    { label: 'gain2', changes: { hardSteerGain: 2 } },
    { label: 'preview8', changes: { hardLookAheadSamples: 8 } },
    { label: 'reserve0.1', changes: { hardCornerReserve: 0.1 } },
    { label: 'reaction8-gain2.5', changes: { hardReaction: 8, hardSteerGain: 2.5 } },
  ],
}
it('diagnoses Hard recovery locations and safer driving candidates', () => {
  const rows = (['green', 'yellow'] as const).flatMap(car =>
    (candidates[car] ?? []).map(candidate => {
      const profile: CarDrivingProfile = { ...CAR_DRIVING_PROFILES[car], ...candidate.changes }
      const run = runLaneCheck({
        path, trackName: track.name, seed: 1, car, difficulty: 'hard',
        reversed: true, handling: 'arcade', mode: 'solo',
        startRatio: track.start?.ratio ?? 0, gridPositions,
        aiProfileOverrides: { [car]: profile }, laps: 2, seconds: 90,
      })
      return {
        car, label: candidate.label, time: run.vehicles[0]?.finishedAt ?? null,
        recoveries: run.vehicles[0]?.recoveries ?? -1,
        offRoad: run.vehicles[0]?.offRoadSeconds ?? -1,
        errors: run.issues.filter(issue => issue.severity === 'error').map(issue => ({
          time: issue.time, code: issue.code, pathIndex: issue.pathIndex,
        })),
      }
    }),
  )
  console.log(`DESERT_HARD_SAFETY_SWEEP ${JSON.stringify(rows)}`)
  expect(rows).toHaveLength(14)
}, 180_000)

const [kids] = decodeTrackInput(JSON.parse(readFileSync(
  'tests/fixtures/kidsRoomAi.trackforge.json', 'utf8',
)))
if (!kids) throw new Error('Missing Kids room')
const pine = OFFICIAL_CIRCUITS.find(circuit => circuit.track.name === 'Pine Hairpins')
const meadow = OFFICIAL_CIRCUITS.find(circuit => circuit.track.name === 'Meadow Loop')
if (!pine || !meadow) throw new Error('Missing official circuits')
const crossTracks = [
  { name: 'Kids room', path: prepareLanePath(kids), reversed: false, startRatio: 0.21932299012693934, laps: 2 },
  { name: 'Pine Hairpins', path: prepareLanePath(pine.track), reversed: false, startRatio: 0, laps: 1 },
  { name: 'Meadow Loop', path: prepareLanePath(meadow.track), reversed: false, startRatio: 0, laps: 2 },
] as const

it('checks the promising Blue planned corner target on other circuit shapes', () => {
  const rows = crossTracks.flatMap(course => [0.04, 0.15].map(bonus => {
    const profile: CarDrivingProfile = {
      ...CAR_DRIVING_PROFILES.blue, hardCornerTargetBonus: bonus,
    }
    const run = runLaneCheck({
      path: course.path, trackName: course.name, seed: 1, car: 'blue',
      difficulty: 'hard', reversed: course.reversed, handling: 'arcade',
      mode: 'solo', startRatio: course.startRatio,
      aiProfileOverrides: { blue: profile }, laps: course.laps, seconds: 135,
    })
    return {
      track: course.name, bonus, time: run.vehicles[0]?.finishedAt ?? null,
      recoveries: run.vehicles[0]?.recoveries ?? -1,
      offRoad: run.vehicles[0]?.offRoadSeconds ?? -1,
      stopped: run.stoppedReason,
    }
  }))
  console.log(`DESERT_BLUE_CROSS_TRACK ${JSON.stringify(rows)}`)
  expect(rows).toHaveLength(6)
}, 180_000)
