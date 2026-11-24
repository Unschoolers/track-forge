#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { compareRaces, replayRuleset, summarizeRace, summarizeTrack } from './summary.mjs'

function usage() {
  console.error('Usage:\n' +
    '  npm run qa:race -- track <track.json> [--json]\n' +
    '  npm run qa:race -- stats <race.json> [--full] [--json]\n' +
    '  npm run qa:race -- compare <old-race.json> <new-race.json> [--json]\n' +
    '  npm run qa:race -- simulate <track.json> [--car red|green|blue|yellow|all]' +
    ' [--mode solo|traffic] [--difficulty hard|normal|easy]' +
    ' [--seed 1] [--laps 2] [--start 0.5] [--grid 2,1,0,3] [--seconds 110]\n' +
    'stats defaults to the player finish time; AI rivals may not finish within the export.')
  process.exitCode = 2
}
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const [command, ...args] = process.argv.slice(2)
const flags = new Set(args.filter((v) => v.startsWith('--')))
function flagValue(name) {
  const index = args.indexOf('--' + name)
  return index < 0 ? undefined : args[index + 1]
}

if (command === 'simulate') {
  const file = args[0]
  if (!file || file.startsWith('--')) {
    usage()
  } else {
    // Simulation is a fresh run of the current engine, never a reenactment
    // of the historical ruleset. Surface that distinction for old exports.
    let inputError
    try {
      const input = readJson(file)
      if (input?.format === 'trackforge-race-replay') {
        const ruleset = replayRuleset(input)
        if (ruleset === 'simulation') {
          console.warn('WARNING: legacy Simulation replay; simulate uses the current Arcade ruleset, not the original physics.')
        }
      }
    } catch (error) {
      inputError = error instanceof Error ? error.message : String(error)
    }
    if (inputError) {
      console.error(inputError)
      process.exit(1)
    }
    const { spawnSync } = await import('node:child_process')
    const { resolve } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const config = {
      cars: flagValue('car'),
      mode: flagValue('mode'),
      difficulty: flagValue('difficulty'),
      seed: Number(flagValue('seed') ?? 1),
      laps: flagValue('laps') ? Number(flagValue('laps')) : undefined,
      seconds: Number(flagValue('seconds') ?? 110),
      ...(flagValue('start') !== undefined ? { startRatio: Number(flagValue('start')) } : {}),
      ...(flagValue('grid') ? { gridPositions: flagValue('grid').split(',').map(Number) } : {}),
    }
    const result = spawnSync(process.execPath, [
      resolve(root, 'node_modules/vitest/vitest.mjs'), 'run',
      'tests/qa/raceAnalysisSimulation.test.ts', '--reporter=verbose',
    ], {
      cwd: root, stdio: 'inherit',
      env: {
        ...process.env, TRACKFORGE_ANALYSIS_TRACK: resolve(file),
        TRACKFORGE_ANALYSIS_OPTIONS: JSON.stringify(config),
      },
    })
    if (result.error) {
      console.error(result.error)
      process.exitCode = 1
    } else {
      process.exitCode = result.status ?? 1
    }
  }
} else {
  const files = args.filter((value) => !value.startsWith('--'))
  if (!['track', 'stats', 'compare'].includes(command) ||
      (command === 'compare' ? files.length !== 2 : files.length !== 1)) {
    usage()
  } else {
    try {
      const data = command === 'track' ? summarizeTrack(readJson(files[0])) :
        command === 'stats' ? summarizeRace(readJson(files[0]), { full: flags.has('--full') }) :
          compareRaces(readJson(files[0]), readJson(files[1]))
      if (flags.has('--json') || command === 'track') {
        console.log(JSON.stringify(data, null, 2))
      } else if (command === 'stats') {
        console.log(data.track.name + ' · ' + data.setup.difficulty + ' · ' +
          data.ruleset + ' · replay v' + data.formatVersion + ' · ' + data.observationType + ' ' +
          data.observationEnd + 's')
        console.log('Geometry fingerprint: ' + data.track.fingerprint)
        console.table(data.vehicles.map((v) => ({
          car: v.car, id: v.id, avg: v.averageSpeed, max: v.maxSpeed,
          braking: v.brakingSeconds, grass: v.grassSeconds,
          curbs: v.events['curb-hit'] ?? 0, recoveries: v.recoveries.length,
          ...(data.ruleset === 'simulation' ? { collisions: v.events.collision ?? 0, barriers: v.events['barrier-collision'] ?? 0 } : {}),
          lap: v.completedLaps,
          finish: v.finishTime === null ? 'not finished in export' : v.finishTime.toFixed(3) + 's',
        })))
        console.table(data.hotspots.slice(0, 12).map((h) => ({
          car: h.car, id: h.id, from: h.pathIndexFrom, to: h.pathIndexTo,
          recoveries: h.counts['vehicle-recovered'] ?? 0,
          curbs: h.counts['curb-hit'] ?? 0,
          times: h.times.slice(0, 8).join(', '),
        })))
        if (data.droppedEvents) console.warn('Replay dropped events: ' + data.droppedEvents)
      } else {
        if (data.warnings.length) console.warn('WARNING:', data.warnings.join('; '))
        console.table(data.comparisons)
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
