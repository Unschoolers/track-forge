// @vitest-environment node
// Opt-in real-track diagnostic. Intentionally skipped by ordinary test runs.
import { readFileSync } from 'node:fs'
import { it, expect } from 'vitest'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { runLaneCheck } from '../../qa/lanes/simulation'
import type { CarId, DifficultyId } from '@/domain/model'

const exportedPath = process.env.TRACKFORGE_ANALYSIS_TRACK
const diagnostic = exportedPath ? it : it.skip
const cars = ['red', 'green', 'blue', 'yellow'] as const

diagnostic('simulates exported geometry with deterministic AI driving', () => {
  if (!exportedPath) throw new Error('TRACKFORGE_ANALYSIS_TRACK is required')
  const exportJson = JSON.parse(readFileSync(exportedPath, 'utf8'))
  const track = exportJson.track
  if (!track || !Array.isArray(track.points) || track.points.length < 4)
    throw new Error('The supplied file does not contain a valid authored track')
  if (!['trackforge-track', 'trackforge-race-replay'].includes(exportJson.format))
    throw new Error('Expected an exported Track Forge track or race replay')
  const options = JSON.parse(process.env.TRACKFORGE_ANALYSIS_OPTIONS ?? '{}')
  const path = buildRoadPath(track.points, track.terrain)
  // Exported races don't currently record startRatio directly. Derive it
  // from the first recorded player position instead of silently using zero.
  const firstPlayer = exportJson.frames?.[0]?.vehicles?.find((v: { player?: boolean }) => v.player)
  const replayStart = exportJson.format === 'trackforge-race-replay'
    ? firstPlayer?.pathDistance / path.totalLength
    : undefined
  if (exportJson.format === 'trackforge-race-replay' &&
      options.startRatio === undefined &&
      (typeof replayStart !== 'number' || !Number.isFinite(replayStart) || replayStart < 0 || replayStart >= 1)) {
    throw new Error('Cannot derive start position from replay; provide --start')
  }
  const startRatio = options.startRatio ?? replayStart ?? track.start?.ratio ?? 0
  const selectedCars: readonly string[] = options.cars === undefined
    ? (exportJson.setup?.car ? [exportJson.setup.car] : cars)
    : options.cars === 'all' ? cars : String(options.cars).split(',')
  if (!selectedCars.length || selectedCars.some((car) => !(cars as readonly string[]).includes(car)))
    throw new Error('Unknown car: expected red, green, blue or yellow')
  const difficulty: DifficultyId = options.difficulty ?? exportJson.setup?.difficulty ?? 'hard'
  const mode = options.mode ?? (exportJson.setup ? 'traffic' : 'solo')
  const laps = options.laps ?? exportJson.setup?.laps ?? 2
  const seconds = options.seconds ?? 110
  const gridPositions = options.gridPositions ?? exportJson.setup?.gridPositions
  const seeds: readonly number[] = options.seeds ?? [options.seed ?? 1]
  const outputs = []
  for (const seed of seeds) {
    for (const carName of selectedCars) {
      const car = carName as CarId
      const run = runLaneCheck({
        path, trackName: track.name ?? 'Exported track',
        seed, car, difficulty, mode,
        handling: options.handling ?? exportJson.setup?.handling ?? 'arcade',
        reversed: options.reversed ?? track.start?.reversed ?? false,
        gridPositions, startRatio, laps, seconds,
      })
      outputs.push({
        seed, car, difficulty, mode, stoppedReason: run.stoppedReason,
        vehicles: run.vehicles.map((vehicle) => ({
          id: vehicle.vehicleId, car: vehicle.car, time: vehicle.finishedAt,
          laps: vehicle.laps, recoveries: vehicle.recoveries,
          offRoadSeconds: vehicle.offRoadSeconds,
          maxLaneError: vehicle.maxLaneError,
        })),
        issues: run.issues.filter((issue) => ['recovery', 'timeout', 'invalid-state'].includes(issue.code))
          .map((issue) => ({
            id: issue.vehicleId, type: issue.code, time: issue.time,
            pathIndex: issue.pathIndex,
          })),
      })
    }
  }
  console.log('TRACKFORGE_AI_DIAGNOSTIC ' + JSON.stringify({
    track: track.name, version: track.version, startRatio, gridPositions,
    rows: outputs,
  }))
  expect(outputs).toHaveLength(seeds.length * selectedCars.length)
}, 180_000)
