// @vitest-environment node
// Desert sand: real player-exported reverse circuit, anonymized geometry.
// Keep identical seeds / starts / mode when comparing AI pace revisions.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'
import type { CarId, DifficultyId } from '@/domain/model'

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
