import { SimulationPool } from '../optimization/pool.mjs'
import { selectScenarios } from '../optimization/scenarios.mjs'
import { compareDifficultyTraces } from './difficulty.mjs'

/** Run the real AI lab twice with matched course, car, grid, seed and mode. */
export async function runDifficultyComparison(args) {
  const value = (name, fallback) => {
    const index = args.indexOf('--' + name)
    if (index < 0) return fallback
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing --${name} value`)
    return args[index + 1]
  }
  const optionsWithValues = new Set(['--car', '--mode', '--seed', '--bin-size', '--normal-bonus', '--normal-reserve'])
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--json') continue
    if (!optionsWithValues.has(args[i])) throw new Error(`Unknown option ${args[i]}`)
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing ${args[i]} value`)
    i++
  }
  const scenarioName = args[0]
  if (!scenarioName || scenarioName.startsWith('--')) throw new Error('Provide a named AI lab scenario')
  const [scenario] = selectScenarios([scenarioName])
  const car = value('car', 'red'), mode = value('mode', 'solo')
  const seed = Number(value('seed', '1')), binSize = Number(value('bin-size', '50'))
  if (!['red', 'blue', 'green', 'yellow'].includes(car)) throw new Error('Invalid car')
  if (!['solo', 'traffic'].includes(mode)) throw new Error('Invalid mode')
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid seed')
  if (!Number.isInteger(binSize) || binSize < 1) throw new Error('Invalid bin-size')
  const overrides = {}
  for (const [flag, key] of [['normal-bonus', 'normalCornerTargetBonus'], ['normal-reserve', 'lowerDifficultyReserveScale']]) {
    const raw = value(flag, undefined)
    if (raw !== undefined) {
      const number = Number(raw)
      if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`Invalid --${flag}`)
      overrides[key] = number
    }
  }
  const pool = new SimulationPool({ workers: 2, scenarios: [scenario], physicsRevision: 'local' })
  await pool.start()
  try {
    const task = difficulty => ({ candidateId: difficulty, car, playerCar: car, focusRole: 'player',
      scenarioId: scenario.id, seed, mode, difficulty, changes: difficulty === 'normal' ? overrides : {}, telemetry: true })
    const [normal, hard] = await Promise.all(['normal', 'hard'].map(difficulty => pool.submit(task(difficulty))))
    const find = run => run.rows.find(row => row.vehicle_id === run.focusVehicleId)
    const recoveryEvents = run => run.events.filter(event => event.vehicle_id === run.focusVehicleId && event.code === 'recovery').map(event => ({
      time: event.event_time, reason: event.recovery_reason, pathIndex: event.path_index,
      speed: event.before_speed, steering: event.before_steering, roadDistance: event.before_road_distance,
    }))
    return { scenario: scenario.id, trackFingerprint: find(normal).track_fingerprint,
      car, mode, seed, laps: scenario.laps, startRatio: scenario.startRatio, reversed: scenario.reverse,
      gridPositions: scenario.gridPositions ?? [0, 1, 2, 3], normalOverrides: overrides,
      normal: { seconds: find(normal).finished_seconds, recoveries: find(normal).recoveries, recoveryEvents: recoveryEvents(normal) },
      hard: { seconds: find(hard).finished_seconds, recoveries: find(hard).recoveries, recoveryEvents: recoveryEvents(hard) },
      ...compareDifficultyTraces(normal, hard, { binSize }) }
  } finally { await pool.close() }
}
