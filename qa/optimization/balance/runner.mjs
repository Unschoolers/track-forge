import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { DEFAULT_CARS } from '../candidates.mjs'
import { SimulationPool } from '../pool.mjs'
import { jsonLines } from '../records.mjs'
import { BALANCE_SCENARIOS, STUDY_SCENARIOS } from '../scenarios.mjs'
import { buildBalanceReport } from './report.mjs'

const FIXED_STEP_HZ = 60
const digest = value => createHash('sha256').update(value).digest('hex')

async function sourceRevision() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const delta = execFileSync('git', ['diff', '--binary', 'HEAD', '--', 'src'], { maxBuffer: 32 * 1024 * 1024 })
  const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard', '--', 'src'], { encoding: 'utf8' })
    .split('\0').filter(Boolean)
  if (!delta.length && !untracked.length) return head
  const hash = createHash('sha256').update(delta)
  for (const path of untracked.sort()) {
    hash.update(JSON.stringify([path, digest(await readFile(path))]))
  }
  return `${head}+src-diff:${hash.digest('hex')}`
}

async function externalHoldouts(files) {
  return Promise.all(files.map(async (file, index) => {
    const input = JSON.parse(await readFile(resolve(file), 'utf8'))
    const track = input?.track ?? input
    if (track?.routeKind === 'point-to-point')
      throw new Error(`Point-to-point holdout requires an open-route simulator: ${file}`)
    return {
      id: `holdout-${index + 1}-${basename(file, '.trackforge.json')}`,
      file: resolve(file), reverse: track?.start?.reversed ?? false,
      startRatio: track?.start?.ratio ?? 0, laps: 2, seconds: 240,
    }
  }))
}

function toRun({ task, result }) {
  const row = result.rows.find(row => row.vehicle_id === result.focusVehicleId)
  if (!row) throw new Error(`Missing balance driver in ${task.scenarioId}/${task.car}`)
  return {
    scenarioId: task.scenarioId, car: task.car, seed: task.seed,
    seconds: row.finished_seconds, status: row.stopped_reason, recoveries: row.recoveries,
    offRoadSeconds: row.offroad_seconds, fingerprint: row.track_fingerprint,
    simulatedSeconds: result.secondsSimulated, workerMs: result.elapsedMs,
  }
}

async function measure(pool, seeds, profiles = null) {
  const tasks = BALANCE_SCENARIOS.flatMap(scenario => DEFAULT_CARS.flatMap(car =>
    seeds.map(seed => ({
      car, playerCar: car, focusRole: 'player', scenarioId: scenario.id, seed,
      candidateId: profiles ? `balance-tuned-${car}` : `balance-base-${car}`,
      difficulty: 'hard', mode: 'solo', policyKind: 'driving',
      changes: profiles?.[car] ?? {},
    })),
  ))
  return Promise.all(tasks.map(async task => ({ task, result: await pool.submit(task) })))
}

function printReport(baseline, runtime, out) {
  console.table(baseline.standings.map(scenario => ({
    scenario: scenario.scenarioId,
    ...Object.fromEntries(scenario.cars.map(row => [row.car, row.meanSeconds?.toFixed(2) ?? 'incomplete'])),
  })))
  console.table(baseline.pairs.map(pair => ({
    comparison: `${pair.carA} vs ${pair.carB}`,
    'mean difference s': pair.overallDifferenceSeconds?.toFixed(2) ?? 'incomplete',
    'time difference %': pair.overallDifferencePercent?.toFixed(2) ?? 'incomplete',
  })))
  console.log(`Baseline: ${baseline.runs.length} trials in ${(runtime.wallMs / 1000).toFixed(2)} s including worker startup. Aggregate throughput: ${runtime.effectiveSpeed.toFixed(1)}× real time.`)
  if (baseline.issues.length) console.log('Incomplete comparisons:', baseline.issues)
  console.log(`Reports: ${out}`)
}

export async function runBalance({ workers, seeds, out, tune, trials, holdoutFiles }) {
  const physicsRevision = await sourceRevision()
  const holdoutScenarios = !tune ? [] : holdoutFiles.length
    ? await externalHoldouts(holdoutFiles)
    : STUDY_SCENARIOS.filter(scenario => scenario.group === 'validation')
  const pool = new SimulationPool({
    workers, scenarios: [...BALANCE_SCENARIOS, ...holdoutScenarios], physicsRevision,
    playerProbes: tune,
  })
  try {
    const started = performance.now()
    await pool.start()
    const ready = performance.now()
    const baselines = await measure(pool, seeds)
    const finished = performance.now()
    const baseline = buildBalanceReport(BALANCE_SCENARIOS, baselines.map(toRun), { seeds })
    const simulatedSeconds = baseline.runs.reduce((sum, run) => sum + run.simulatedSeconds, 0)
    const wallMs = finished - started
    const runtime = {
      workers, wallMs, startupMs: ready - started, executionMs: finished - ready, simulatedSeconds,
      effectiveSpeed: simulatedSeconds / (wallMs / 1000),
      executionSpeed: simulatedSeconds / ((finished - ready) / 1000),
    }
    const profileRevision = digest(JSON.stringify(pool.baselineProfiles))
    const summary = {
      schemaVersion: 1, mode: 'hard-ai-solo', physicsRevision, profileRevision, scenarios: BALANCE_SCENARIOS,
      settings: { physicsHz: FIXED_STEP_HZ, seeds, seedIdentical: seeds.length > 1 && BALANCE_SCENARIOS.every(scenario =>
        DEFAULT_CARS.every(car => {
          const runs = baseline.runs.filter(run => run.scenarioId === scenario.id && run.car === car)
          return new Set(runs.map(run => JSON.stringify([run.seconds, run.status, run.recoveries, run.offRoadSeconds]))).size === 1
        })) }, runtime, baseline,
    }
    const records = [...baselines]
    if (tune) {
      const { tuneBalance } = await import('./tune.mjs')
      const { records: tuningRecords, ...tuning } = await tuneBalance({
        pool, scenarios: BALANCE_SCENARIOS, holdoutScenarios, seeds, trials, baselines,
      })
      const tuned = await measure(pool, seeds, tuning.selectedChanges)
      records.push(...tuningRecords, ...tuned)
      summary.tuning = {
        ...tuning, holdoutScenarios,
        validation: tuning.combined.eligible && tuning.perCar.every(row => !row.validation || row.validation.eligible)
          ? 'passed' : 'rejected',
        studyWallMs: performance.now() - started,
      }
      summary.tuned = buildBalanceReport(BALANCE_SCENARIOS, tuned.map(toRun), { seeds })
      summary.playerProbes = pool.playerProbes
    }
    await mkdir(out, { recursive: true })
    await Promise.all([
      writeFile(resolve(out, 'baseline-results.json'), JSON.stringify(baselines) + '\n'),
      writeFile(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n'),
      writeFile(resolve(out, 'runs.jsonl'), jsonLines(records.flatMap(record => record.result.rows))),
      writeFile(resolve(out, 'events.jsonl'), jsonLines(records.flatMap(record => record.result.events))),
    ])
    printReport(baseline, runtime, out)
    if (summary.tuning) {
      console.log(`Tuning holdout validation: ${summary.tuning.validation}. Study time: ${(summary.tuning.studyWallMs / 1000).toFixed(2)} s.`)
      if (summary.tuning.validation === 'rejected') process.exitCode = 1
    }
    if (!baseline.complete || (summary.tuned && !summary.tuned.complete)) process.exitCode = 1
  } finally {
    await pool.close()
  }
}
