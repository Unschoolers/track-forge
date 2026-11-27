// Reusable offline sector diagnosis using the lane checker's authoritative engine.
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { REPLAY_STUDY_SCENARIOS } from './scenarios.mjs'
import { sectorCollector } from './sectorTelemetry.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const out = resolve(process.argv[2] ?? 'qa/results/ora-ora')
const scenario = REPLAY_STUDY_SCENARIOS.find(s => s.id === 'ora-ora-replay')
if (!scenario) throw new Error('Missing replay scenario')
// Exact gate times from the uploaded 28.467s run, not its separate 26.633s saved ghost.
const reference = [500, 830, 849, 1277, 1690, 1708].map(tick => tick / 60)
const server = await createServer({
  root, configFile: resolve(root, 'vite.config.ts'),
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom', logLevel: 'error',
})
try {
  const { prepareLanePath, decodeTrackInput } = await server.ssrLoadModule('/qa/lanes/scenarios.ts')
  const { runLaneCheck } = await server.ssrLoadModule('/qa/lanes/simulation.ts')
  const { CAR_IDS } = await server.ssrLoadModule('/src/domain/model.ts')
  const path = prepareLanePath(decodeTrackInput(JSON.parse(readFileSync(resolve(root, scenario.file), 'utf8')))[0])
  const rows = []
  for (const car of CAR_IDS) for (const difficulty of ['hard', 'normal']) for (const seed of [1, 4331]) {
    const collector = sectorCollector()
    const samples = []
    const run = runLaneCheck({
      path, trackName: scenario.id, car, difficulty, seed, mode: 'solo',
      reversed: scenario.reverse, startRatio: scenario.startRatio,
      gridPositions: scenario.gridPositions, laps: scenario.laps, seconds: scenario.seconds,
      observeStep(previous, result) {
        const before = previous.vehicles[0]
        const after = result.state.vehicles[0]
        if (!before || !after) throw new Error('Missing solo vehicle')
        const gates = result.events.filter(event => event.type === 'gate-crossed' && event.vehicleId === after.id)
        collector.observe(before, after, gates)
        if (result.state.tick % 3 === 0 || gates.length) {
          const slip = Math.atan2(-after.vx * Math.sin(after.angle) + after.vy * Math.cos(after.angle),
            after.vx * Math.cos(after.angle) + after.vy * Math.sin(after.angle))
          samples.push({ time: result.state.elapsed, lap: after.lap, pathIndex: after.pathIndex,
            pathDistance: after.pathDistance, x: after.x, y: after.y, speed: after.speed,
            braking: after.braking, surface: after.currentSurface, grounded: after.grounded,
            slipRadians: slip })
        }
      },
    })
    const vehicle = run.vehicles[0]
    if (!vehicle) throw new Error('Missing vehicle metrics')
    const sectors = collector.sectors.map((sector, index) => ({
      ...sector,
      // Compare different chassis descriptively; Red Normal is the closest matched setup.
      referenceSeconds: reference[index] === undefined ? null : reference[index] - (reference[index - 1] ?? 0),
      cumulativeGap: reference[index] === undefined ? null : sector.time - reference[index],
    }))
    const row = { car, difficulty, seed, seconds: vehicle.finishedAt, recoveries: vehicle.recoveries,
      offRoadSeconds: vehicle.offRoadSeconds, stoppedReason: run.stoppedReason, sectors }
    rows.push({ ...row, samples })
    console.log('ORA_SECTOR_RESULT ' + JSON.stringify(row))
    if (run.stoppedReason === 'invalid-state') throw new Error('Invalid AI simulation state')
  }
  await mkdir(out, { recursive: true })
  await writeFile(resolve(out, 'sector-diagnosis.json'), JSON.stringify({ reference, rows }, null, 2) + '\n')
} finally {
  await server.close()
}
