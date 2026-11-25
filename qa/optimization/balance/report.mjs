import { DEFAULT_CARS as CARS } from '../candidates.mjs'
const STATUSES = ['finished', 'timeout', 'invalid-state']
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length
const key = (scenarioId, car, seed) => JSON.stringify([scenarioId, car, seed])

/**
 * Compare matched seeds within each scenario. Ratios are A's mean time divided
 * by B's mean time; negative differences mean A is faster. Overall ratios give
 * each scenario equal weight. Incomplete pairs never receive an overall score.
 */
export function buildBalanceReport(scenarios, runs, { seeds = [1] } = {}) {
  if (!Array.isArray(scenarios) || !scenarios.length || scenarios.some(s => !s || typeof s.id !== 'string' || !s.id) || new Set(scenarios.map(s => s.id)).size !== scenarios.length)
    throw new Error('Scenarios must have unique nonempty IDs')
  if (!Array.isArray(runs)) throw new Error('Runs must be an array')
  if (!Array.isArray(seeds) || !seeds.length || seeds.some(s => !Number.isSafeInteger(s)) || new Set(seeds).size !== seeds.length)
    throw new Error('Seeds must be unique integers')

  const scenarioIds = new Set(scenarios.map(s => s.id))
  const seedSet = new Set(seeds)
  const grouped = new Map()
  const issues = []
  for (const [index, run] of runs.entries()) {
    if (!run || !scenarioIds.has(run.scenarioId) || !CARS.includes(run.car) || !seedSet.has(run.seed)) {
      issues.push({ type: 'unexpected-run', index })
      continue
    }
    const id = key(run.scenarioId, run.car, run.seed)
    const records = grouped.get(id) ?? []
    records.push({ run, index })
    grouped.set(id, records)
  }
  const valid = new Map()
  const mismatched = new Set()
  for (const scenario of scenarios) {
    const fingerprints = new Set(runs.filter(r => r?.scenarioId === scenario.id && typeof r.fingerprint === 'string' && r.fingerprint).map(r => r.fingerprint))
    if (fingerprints.size > 1) {
      issues.push({ type: 'fingerprint-mismatch', scenarioId: scenario.id, fingerprints: [...fingerprints] })
      mismatched.add(scenario.id)
    }
    for (const car of CARS) for (const seed of seeds) {
      const id = key(scenario.id, car, seed)
      const records = grouped.get(id) ?? []
      const identity = { scenarioId: scenario.id, car, seed }
      if (!records.length) { issues.push({ type: 'missing', ...identity }); continue }
      if (records.length > 1) { issues.push({ type: 'duplicate', ...identity, indices: records.map(r => r.index) }); continue }
      const { run, index } = records[0]
      if (!STATUSES.includes(run.status) || !Number.isInteger(run.recoveries) || run.recoveries < 0 ||
          (run.offRoadSeconds !== undefined && (!Number.isFinite(run.offRoadSeconds) || run.offRoadSeconds < 0)) ||
          (run.fingerprint !== undefined && (typeof run.fingerprint !== 'string' || !run.fingerprint)) ||
          (run.status === 'finished' ? !Number.isFinite(run.seconds) || run.seconds <= 0 : run.seconds !== null && (!Number.isFinite(run.seconds) || run.seconds < 0))) {
        issues.push({ type: 'invalid-run', ...identity, index }); continue
      }
      if (run.status !== 'finished') { issues.push({ type: 'failed', ...identity, index, status: run.status }); continue }
      valid.set(id, run)
    }
  }
  const pairs = []
  for (let a = 0; a < CARS.length; a++) for (let b = a + 1; b < CARS.length; b++) {
    const carA = CARS[a], carB = CARS[b]
    const rows = scenarios.map(scenario => {
      const matched = seeds.map(seed => [valid.get(key(scenario.id, carA, seed)), valid.get(key(scenario.id, carB, seed))])
      const complete = !mismatched.has(scenario.id) && matched.every(([first, second]) => first && second)
      if (!complete) return { scenarioId: scenario.id, complete: false, meanSecondsA: null, meanSecondsB: null, differenceSeconds: null, differencePercent: null, ratio: null }
      const meanSecondsA = mean(matched.map(([first]) => first.seconds))
      const meanSecondsB = mean(matched.map(([, second]) => second.seconds))
      const ratio = meanSecondsA / meanSecondsB
      return { scenarioId: scenario.id, complete: true, meanSecondsA, meanSecondsB, differenceSeconds: meanSecondsA - meanSecondsB, differencePercent: (ratio - 1) * 100, ratio }
    })
    const complete = rows.every(row => row.complete)
    const geometricMeanRatio = complete ? Math.exp(mean(rows.map(row => Math.log(row.ratio)))) : null
    pairs.push({
      carA, carB, scenarios: rows, complete, geometricMeanRatio,
      overallDifferenceSeconds: complete ? mean(rows.map(row => row.differenceSeconds)) : null,
      overallDifferencePercent: complete ? (geometricMeanRatio - 1) * 100 : null,
    })
  }
  const standings = scenarios.map(scenario => {
    const cars = CARS.map(car => {
      const matched = seeds.map(seed => valid.get(key(scenario.id, car, seed)))
      return {
        car,
        meanSeconds: !mismatched.has(scenario.id) && matched.every(Boolean)
          ? mean(matched.map(run => run.seconds)) : null,
      }
    })
    const complete = cars.every(row => row.meanSeconds !== null)
    const fastest = complete ? Math.min(...cars.map(row => row.meanSeconds)) : null
    return { scenarioId: scenario.id, complete, cars: cars.map(row => ({
      ...row, percentBehindFastest: complete ? (row.meanSeconds / fastest - 1) * 100 : null,
    })) }
  })
  const carHighlights = CARS.map(car => {
    const ranked = standings.filter(row => row.complete).map(row => ({
      scenarioId: row.scenarioId,
      percentBehindFastest: row.cars.find(entry => entry.car === car).percentBehindFastest,
    })).sort((a, b) => a.percentBehindFastest - b.percentBehindFastest)
    return { car, best: ranked[0] ?? null, worst: ranked.at(-1) ?? null }
  })
  return { scenarios, seeds: [...seeds], runs, complete: issues.length === 0, issues, standings, carHighlights, pairs }
}
