// @vitest-environment node
// Desert sand: real player-exported reverse circuit, anonymized geometry.
// Keep identical seeds / starts / mode when comparing AI pace revisions.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'
import type { CarId, DifficultyId } from '@/domain/model'
import { CAR_DRIVING_PROFILES, type CarDrivingProfile } from '@/domain/race/ai/aiCarDrivingProfiles'

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
const candidates: Readonly<Record<CarId, readonly Candidate[]>> = {
  red: [
    { label: 'base', changes: {} },
    { label: 'corner0.12', changes: { hardCornerTargetBonus: 0.12 } },
    { label: 'corner0.18', changes: { hardCornerTargetBonus: 0.18 } },
    { label: 'lookahead8', changes: { hardLookAheadSamples: 8 } },
    { label: 'lookahead12', changes: { hardLookAheadSamples: 12 } },
    { label: 'reserve0', changes: { hardCornerReserve: 0 } },
  ],
  blue: [
    { label: 'base', changes: {} },
    { label: 'corner0.10', changes: { hardCornerTargetBonus: 0.10 } },
    { label: 'corner0.15', changes: { hardCornerTargetBonus: 0.15 } },
    { label: 'lookahead8', changes: { hardLookAheadSamples: 8 } },
    { label: 'lookahead12', changes: { hardLookAheadSamples: 12 } },
    { label: 'lookahead14', changes: { hardLookAheadSamples: 14 } },
  ],
  green: [
    { label: 'base', changes: {} },
    { label: 'edge0.6', changes: { hardEdgeAvoidanceScale: 0.6 } },
    { label: 'edge0.8', changes: { hardEdgeAvoidanceScale: 0.8 } },
    { label: 'corner0.20', changes: { hardCornerTargetBonus: 0.20 } },
    { label: 'reserve0.05', changes: { hardCornerReserve: 0.05 } },
    { label: 'preview8', changes: { hardLookAheadSamples: 8 } },
  ],
  yellow: [
    { label: 'base', changes: {} },
    { label: 'corner0.25', changes: { hardCornerTargetBonus: 0.25 } },
    { label: 'corner0.35', changes: { hardCornerTargetBonus: 0.35 } },
    { label: 'reserve0.04', changes: { hardCornerReserve: 0.04 } },
    { label: 'preview14', changes: { hardLookAheadSamples: 14 } },
    { label: 'preview16', changes: { hardLookAheadSamples: 16 } },
  ],
}

it('screens car-specific Hard decisions on Desert sand without changing physics', () => {
  const rows = cars.flatMap(car => candidates[car].map(candidate => {
    const profile: CarDrivingProfile = { ...CAR_DRIVING_PROFILES[car], ...candidate.changes }
    const run = runLaneCheck({
      path, trackName: track.name, seed: 1, car,
      difficulty: 'hard', reversed: true, handling: 'arcade', mode: 'solo',
      gridPositions, startRatio: track.start?.ratio ?? 0,
      aiProfileOverrides: { [car]: profile },
      laps: 2, seconds: 90,
    })
    return {
      car, label: candidate.label,
      time: run.vehicles[0]?.finishedAt ?? null,
      recoveries: run.vehicles[0]?.recoveries ?? -1,
      offRoad: run.vehicles[0]?.offRoadSeconds ?? -1,
      stopped: run.stoppedReason,
    }
  }))
  console.log(`DESERT_HARD_PROFILE_SWEEP ${JSON.stringify(rows)}`)
  expect(rows).toHaveLength(24)
}, 180_000)
