import { parentPort, workerData, threadId } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { projectTrial } from './records.mjs'
import { trackFingerprint } from '../race-analysis/summary.mjs'

if (!parentPort) throw new Error('AI lab worker must be started by a parent')
const port = parentPort
const root = fileURLToPath(new URL('../../', import.meta.url))

const server = await createServer({
  root, configFile: resolve(root, 'vite.config.ts'),
  // Vite SSR loaders in separate threads otherwise contend for its default
  // HMR WebSocket port, even with a headless middleware host.
  server: { middlewareMode: true, hmr: { port: 26000 + threadId }, watch: null },
  appType: 'custom', logLevel: 'error',
})
try {
  // Vite SSR respects the project's TypeScript path aliases. The game engine
  // runs unchanged inside the worker; no separate approximate physics model.
  const { decodeTrackInput, prepareLanePath } =
    await server.ssrLoadModule('/qa/lanes/scenarios.ts')
  const { runLaneCheck } =
    await server.ssrLoadModule('/qa/lanes/simulation.ts')
  const { OFFICIAL_CIRCUITS } =
    await server.ssrLoadModule('/src/domain/track/officialCircuits.ts')
  const { CAR_DRIVING_PROFILES } =
    await server.ssrLoadModule('/src/domain/race/ai/aiCarDrivingProfiles.ts')
  const { CAR_PASSING_POLICIES } =
    await server.ssrLoadModule('/src/domain/race/ai/aiCarPassingPolicies.ts')

  const tracks = new Map()
  for (const scenario of workerData.scenarios) {
    let track
    if (scenario.file) {
      const decoded = decodeTrackInput(JSON.parse(
        readFileSync(resolve(root, scenario.file), 'utf8'),
      ))
      track = decoded[0]
    } else {
      track = OFFICIAL_CIRCUITS.find(x => x.track.name === scenario.officialName)?.track
    }
    if (!track) throw new Error(`Missing scenario geometry: ${scenario.id}`)
    tracks.set(scenario.id, {
      path: prepareLanePath(track),
      trackName: track.name,
      fingerprint: trackFingerprint({ track }),
    })
  }
  port.postMessage({ type: 'ready', baselineProfiles: CAR_DRIVING_PROFILES,
    passingProfiles: CAR_PASSING_POLICIES })

  port.on('message', message => {
    if (message.type !== 'trial') return
    const started = performance.now()
    const { task, id } = message
    try {
      const entry = tracks.get(task.scenarioId)
      const scenario = workerData.scenarios.find(x => x.id === task.scenarioId)
      if (!entry || !scenario) throw new Error(`Unknown scenario ${task.scenarioId}`)
      const passingStudy = task.policyKind === 'passing'
      if (task.policyKind !== undefined && task.policyKind !== 'passing' &&
          task.policyKind !== 'driving') throw new Error('Unknown policy kind')
      const baseline = (passingStudy ? CAR_PASSING_POLICIES : CAR_DRIVING_PROFILES)[task.car]
      if (!baseline) throw new Error(`Unknown car ${task.car}`)
      const policy = { ...baseline, ...task.changes }
      const drivingOverrides = task.profileOverrides ? Object.fromEntries(Object.entries(task.profileOverrides).map(([car, changes]) => {
        if (!CAR_DRIVING_PROFILES[car]) throw new Error(`Unknown override car ${car}`)
        return [car, { ...CAR_DRIVING_PROFILES[car], ...changes }]
      })) : { [task.car]: policy }
      if (passingStudy && task.profileOverrides) throw new Error('Combined overrides are driving-only')
      const trialGrid = task.mode === 'duel' ? [2, 0, 1, 3] : scenario.gridPositions
      const run = runLaneCheck({
        path: entry.path, trackName: entry.trackName,
        seed: task.seed, car: task.playerCar ?? task.car, difficulty: task.difficulty,
        reversed: scenario.reverse,
        // Passing policy trials use AI-controlled rivals as reproducible
        // stand-ins for a human obstacle. Production AI↔AI traffic remains
        // compact; this legacy mode is confined to these offline studies.
        ...(passingStudy ? { aiAiTrafficMode: 'legacy' } : {}),
        mode: task.mode, startRatio: scenario.startRatio,
        ...(trialGrid ? { gridPositions: trialGrid } : {}),
        ...(task.mode === 'duel' ? { duelOpponentCar: task.opponentCar,
          ...(task.duelOpponentSpeedLimit !== undefined ? { duelOpponentSpeedLimit: task.duelOpponentSpeedLimit } : {}) } : {}),
        laps: scenario.laps, seconds: scenario.seconds,
        ...(passingStudy
          ? { aiPassingPolicyOverrides: { [task.car]: policy } }
          : { aiProfileOverrides: drivingOverrides }),
      })
      const exported = projectTrial(run, {
        candidateId: task.candidateId, scenarioId: scenario.id,
        driverCar: task.playerCar ?? task.car, tunedCar: task.car,
        focusRole: task.focusRole ?? 'player',
        gridPositions: trialGrid?.join(',') ?? null,
        opponentCar: task.opponentCar ?? null,
        duelOpponentSpeedLimit: task.duelOpponentSpeedLimit ?? null,
        policyKind: task.policyKind ?? 'driving',
        seed: task.seed, difficulty: task.difficulty,
        mode: task.mode, startRatio: scenario.startRatio,
        trackFingerprint: entry.fingerprint,
        physicsRevision: workerData.physicsRevision,
      }, { telemetry: task.telemetry === true })
      // A tuned car can be a *rival*, not only the AI-driven player slot.
      // Using the first vehicle exclusively missed the historical Kids Room
      // recovery regression when Green was racing behind a Red player.
      const focus = task.focusRole === 'rival'
        ? run.vehicles.find(vehicle => vehicle.car === task.car &&
            vehicle.vehicleId !== run.vehicles[0]?.vehicleId)
        : run.vehicles[0]
      if (!focus || focus.car !== task.car)
        throw new Error(`Tuned ${task.car} ${task.focusRole ?? 'player'} absent from simulation`)
      port.postMessage({
        type: 'result', id,
        result: {
          focusVehicleId: focus.vehicleId,
          ...exported,
          driverVehicleId: run.vehicles[0]?.vehicleId ?? null,
          secondsSimulated: run.simulatedSeconds,
          elapsedMs: Math.round(performance.now() - started),
        },
      })
    } catch (error) {
      port.postMessage({
        type: 'error', id,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      })
    }
  })
} catch (error) {
  port.postMessage({
    type: 'fatal',
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  })
  await server.close()
  process.exitCode = 1
}
