// Offline, deterministic jump contract: observe the real 60 Hz engine, not
// sampled telemetry that can miss the one-tick takeoff flag.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { JUMP_STUDY_SCENARIOS } from './scenarios.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const out = resolve(process.argv[2] ?? 'qa/results/jump-flight')
const server = await createServer({
  root, configFile: resolve(root, 'vite.config.ts'),
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom', logLevel: 'error',
})
const rows = []
const failures = []
try {
  const { prepareLanePath, decodeTrackInput } = await server.ssrLoadModule('/qa/lanes/scenarios.ts')
  const { runLaneCheck } = await server.ssrLoadModule('/qa/lanes/simulation.ts')
  const { CAR_IDS, DIFFICULTY_IDS } = await server.ssrLoadModule('/src/domain/model.ts')
  for (const scenario of JUMP_STUDY_SCENARIOS) {
    const path = prepareLanePath(decodeTrackInput(scenario.track)[0])
    if (!path.roadSurface.jumpLips.length) throw new Error('Missing compiled jump: ' + scenario.id)
    for (const car of CAR_IDS) for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [1, 4331]) for (const mode of ['solo', 'traffic']) {
        const flights = new Map()
        const completed = new Map()
        const run = runLaneCheck({
          path, trackName: scenario.id, car, difficulty, seed, mode,
          reversed: false, startRatio: scenario.startRatio, laps: scenario.laps,
          seconds: scenario.seconds,
          observeStep(previous, result) {
            const recovered = new Set(result.events.filter(event => event.type === 'vehicle-recovered').map(event => event.vehicleId))
            const prior = new Map(previous.vehicles.map(vehicle => [vehicle.id, vehicle]))
            for (const vehicle of result.state.vehicles) {
              if (prior.get(vehicle.id)?.finishedAt !== null) continue
              if (vehicle.jumpLaunched) {
                if (flights.has(vehicle.id)) throw new Error('Overlapping intentional flights: ' + vehicle.id)
                flights.set(vehicle.id, {
                  takeoff: result.state.elapsed, speed: vehicle.speed, peakZ: vehicle.z,
                  bridgeFall: false, recovered: false, landed: false,
                })
              }
              const flight = flights.get(vehicle.id)
              if (!flight) continue
              flight.peakZ = Math.max(flight.peakZ, vehicle.z)
              flight.bridgeFall ||= vehicle.bridgeFallSeconds !== undefined
              flight.recovered ||= recovered.has(vehicle.id)
              if (vehicle.grounded || flight.recovered || vehicle.finishedAt !== null) {
                flight.landed = vehicle.grounded && !flight.recovered
                flight.duration = result.state.elapsed - flight.takeoff
                const list = completed.get(vehicle.id) ?? []
                list.push(flight)
                completed.set(vehicle.id, list)
                flights.delete(vehicle.id)
              }
            }
          },
        })
        for (const vehicle of run.vehicles) {
          const list = completed.get(vehicle.vehicleId) ?? []
          const active = flights.get(vehicle.vehicleId)
          const row = {
            scenario: scenario.id, difficulty, seed, mode, selectedCar: car,
            vehicle: vehicle.vehicleId, car: vehicle.car, seconds: vehicle.finishedAt,
            recoveries: vehicle.recoveries, launches: list.length + Number(Boolean(active)),
            landings: list.filter(flight => flight.landed).length,
            flights: active ? [...list, active] : list,
          }
          rows.push(row)
          const label = [row.scenario, car, difficulty, seed, mode, row.vehicle].join('/')
          if (row.flights.some(flight => flight.bridgeFall || flight.recovered))
            failures.push(label + ': intentional flight triggered recovery')
          if (mode === 'solo' && (row.seconds === null || row.launches !== scenario.laps * path.roadSurface.jumpLips.length || row.landings !== row.launches))
            failures.push(label + ': incomplete authored jump traversal')
        }
      }
    }
  }
  // Report pace ordering without inventing a new acceptance tolerance.
  const ordering = []
  for (const scenario of JUMP_STUDY_SCENARIOS) for (const car of CAR_IDS) for (const seed of [1, 4331]) {
    const times = Object.fromEntries(rows.filter(row => row.scenario === scenario.id && row.car === car &&
      row.seed === seed && row.mode === 'solo').map(row => [row.difficulty, row.seconds]))
    ordering.push({ scenario: scenario.id, car, seed, times,
      ordered: Object.values(times).every(Number.isFinite) && times.hard <= times.normal && times.normal <= times.easy })
  }
  await mkdir(out, { recursive: true })
  await writeFile(resolve(out, 'flight-matrix.json'), JSON.stringify({ rows, ordering, failures }, null, 2) + '\n')
  console.log('JUMP_FLIGHT_RESULT ' + JSON.stringify({
    trials: rows.length, failures, ordering,
    solo: rows.filter(row => row.mode === 'solo' && row.seed === 1).map(({ flights, ...row }) => row),
  }))
  if (failures.length) process.exitCode = 1
} finally {
  await server.close()
}
