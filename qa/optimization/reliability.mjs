import { mkdir, writeFile } from 'node:fs/promises'
import { SimulationPool } from './pool.mjs'
import { STUDY_SCENARIOS } from './scenarios.mjs'
import { DEFAULT_CARS } from './candidates.mjs'
import { evaluatePair } from './score.mjs'

const output = 'qa/results/reliability'
const hairpins = [false, true].map(reverse => ({
  id: reverse ? 'hairpin-matrix-reverse' : 'hairpin-matrix-forward',
  laneScenarioId: 'hairpin', reverse, startRatio: 0, laps: 1, seconds: 60,
}))
const scenarios = [...hairpins, ...STUDY_SCENARIOS]
const pool = new SimulationPool({ workers: 2, scenarios, physicsRevision: process.env.GITHUB_SHA ?? 'local' })
const matrix = hairpins.flatMap(s => ['easy', 'normal', 'hard'].flatMap(difficulty =>
  DEFAULT_CARS.flatMap(car => ['solo', 'traffic'].map(mode => ({
    car, scenarioId: s.id, difficulty, mode, seed: 1, policyKind: 'driving',
  })))))
const validation = STUDY_SCENARIOS.flatMap(s => [1, 4331].flatMap(seed =>
  DEFAULT_CARS.flatMap(car => ['solo', 'traffic'].map(mode => ({
    car, scenarioId: s.id, difficulty: 'hard', mode, seed, policyKind: 'driving',
  })))))
const proposals = [
  { technicalCornerPaceScale: 0.95 },
  { technicalCornerPaceScale: 0.85 },
  { technicalCornerPaceScale: 0.75 },
  { technicalCornerPursuitScale: 0.85 },
  { technicalCornerPursuitScale: 0.7 },
  { technicalCornerPaceScale: 0.85, technicalCornerPursuitScale: 0.85 },
  { technicalCornerPaceScale: 0.75, technicalCornerPursuitScale: 0.7 },
  { technicalCornerPaceScale: 0.7, technicalCornerPursuitScale: 0.9 },
]
function metrics(records) {
  const rows = records.flatMap(x => x.rows)
  return {
    dnf: rows.filter(x => x.finished_seconds === null).length,
    recoveries: rows.reduce((n, x) => n + x.recoveries, 0),
    errors: records.flatMap(x => x.events).filter(x => x.severity === 'error' && x.code !== 'recovery' && x.code !== 'timeout').length,
    seconds: rows.reduce((n, x) => n + (x.finished_seconds ?? 60), 0),
    offroad: rows.reduce((n, x) => n + x.offroad_seconds, 0),
  }
}
function compare(a, b) {
  return a.errors - b.errors || a.dnf - b.dnf || a.recoveries - b.recoveries || a.seconds - b.seconds || a.offroad - b.offroad
}
function noNewDebt(before, after) {
  return before.length === after.length && before.every((old, i) => {
    const current = after[i]
    if (old.rows.length !== current.rows.length) return false
    if (current.events.some(x => x.severity === 'error' && x.code !== 'recovery' && x.code !== 'timeout')) return false
    return old.rows.every(row => {
      const next = current.rows.find(x => x.vehicle_id === row.vehicle_id)
      return next && next.car_type === row.car_type && next.recoveries <= row.recoveries &&
        (row.finished_seconds === null || next.finished_seconds !== null)
    })
  })
}
async function simulate(cases, profiles, candidateId) {
  return Promise.all(cases.map(task => pool.submit({ ...task, candidateId, changes: {}, profileOverrides: profiles })))
}
function findings(cases, records) {
  return records.flatMap((record, i) => {
    const problems = record.rows.filter(x => x.recoveries || x.finished_seconds === null)
    return problems.length ? [{ ...cases[i], vehicles: problems.map(x => ({
      car: x.car_type, id: x.vehicle_id, recoveries: x.recoveries, seconds: x.finished_seconds,
    })), events: record.events.filter(x => x.severity === 'error' || x.code === 'missed-gate') }] : []
  })
}
try {
  await pool.start()
  const baseline = await simulate(matrix, {}, 'baseline')
  const baselineMetrics = metrics(baseline)
  console.log('RELIABILITY_BASELINE ' + JSON.stringify({ metrics: baselineMetrics, failures: findings(matrix, baseline) }))
  let profiles = {}
  let current = baseline
  const history = []
  // Coordinate search: every proposal is tested in all races containing the
  // edited chassis. Accepted changes become the baseline for the next car,
  // avoiding the unsafe combination of independently selected profiles.
  for (const car of ['yellow', 'red', 'green', 'blue']) {
    const indices = matrix.map((_, i) => i).filter(i => current[i].rows.some(row => row.car_type === car))
    const cases = indices.map(i => matrix[i])
    const old = indices.map(i => current[i])
    let best = { records: old, changes: profiles[car] ?? {}, metrics: metrics(old) }
    const edits = [...proposals, ...(car === 'yellow' ? [
      { hardLookAheadSamples: 9 },
      { hardCornerTargetBonus: 0.25, technicalCornerPaceScale: 0.85 },
      { hardLookAheadSamples: 9, technicalCornerPaceScale: 0.85 },
    ] : [])]
    for (const [i, changes] of edits.entries()) {
      const records = await simulate(cases, { ...profiles, [car]: changes }, car + '-' + i)
      const result = metrics(records)
      const eligible = noNewDebt(old, records)
      history.push({ car, changes, eligible, metrics: result })
      if (eligible && compare(result, best.metrics) < 0) best = { records, changes, metrics: result }
    }
    profiles = { ...profiles, [car]: best.changes }
    const next = [...current]
    indices.forEach((index, i) => { next[index] = best.records[i] })
    current = next
    console.log('RELIABILITY_CAR ' + JSON.stringify({ car, changes: best.changes, metrics: metrics(current) }))
  }
  const combined = await simulate(matrix, profiles, 'combined')
  const before = await simulate(validation, {}, 'cross-track-baseline')
  const after = await simulate(validation, profiles, 'cross-track-combined')
  const comparisons = after.map((row, i) => evaluatePair(before[i], row))
  const regressions = comparisons.filter(x => !x.eligible)
  const final = metrics(combined)
  const accepted = noNewDebt(baseline, combined) && final.errors === 0 && final.dnf === 0 &&
    final.recoveries === 0 && regressions.length === 0
  const report = { accepted, profiles, baseline: baselineMetrics, combined: final,
    failures: findings(matrix, combined), regressions, history, crossTrackTrials: validation.length }
  await mkdir(output, { recursive: true })
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
  console.log('RELIABILITY_RESULT ' + JSON.stringify(report))
  if (!accepted) process.exitCode = 1
} finally {
  await pool.close()
}
