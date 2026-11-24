import { mkdir, writeFile } from 'node:fs/promises'
import { SimulationPool } from './pool.mjs'
import { STUDY_SCENARIOS } from './scenarios.mjs'
import { DEFAULT_CARS, generateCandidates } from './candidates.mjs'
import { metrics, noNewDebt, crossTrackRegressions, compareReliability, compareResults } from './reliabilityScore.mjs'

const output = 'qa/results/reliability'
const verifyOnly = process.argv.includes('--verify-only')
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
  { technicalCornerPursuitScale: 0.9 },
  { technicalCornerPursuitScale: 0.85 },
  { technicalCornerPursuitScale: 0.75 },
  { technicalCornerPursuitScale: 0.7 },
  { technicalCornerPaceScale: 0.97 },
  { technicalCornerPaceScale: 0.95 },
  { technicalCornerPaceScale: 0.9 },
  { technicalCornerPaceScale: 0.85 },
  { technicalCornerPaceScale: 0.95, technicalCornerPursuitScale: 0.85 },
  ...[0.3, 0.55, 0.8].flatMap(technicalCornerActivation => [
    { technicalCornerActivation, technicalCornerPaceScale: 0.85 },
    { technicalCornerActivation, technicalCornerPursuitScale: 0.7 },
    { technicalCornerActivation, technicalCornerPaceScale: 0.9, technicalCornerPursuitScale: 0.8 },
  ]),
]
const cache = new Map()
function profileKey(profiles) {
  return JSON.stringify(Object.entries(profiles).filter(([, values]) => Object.keys(values).length)
    .sort(([a], [b]) => a.localeCompare(b)).map(([car, values]) => [car, Object.entries(values).sort(([a], [b]) => a.localeCompare(b))]))
}
async function simulate(cases, profiles, candidateId) {
  const key = profileKey(profiles)
  return Promise.all(cases.map(task => {
    const id = key + '/' + JSON.stringify(task)
    if (!cache.has(id)) cache.set(id, pool.submit({ ...task, candidateId, changes: {}, profileOverrides: profiles }))
    return cache.get(id)
  }))
}
function findings(cases, records) {
  return records.flatMap((record, i) => {
    const problems = record.rows.filter(x => x.recoveries || x.finished_seconds === null)
    return problems.length ? [{ ...cases[i], vehicles: problems.map(x => ({
      car: x.car_type, id: x.vehicle_id, recoveries: x.recoveries, seconds: x.finished_seconds,
    })), events: record.events.filter(x => x.severity === 'error' || x.code === 'missed-gate') }] : []
  })
}
function affected(records, car) {
  return records.map((record, i) => record.rows.some(row => row.car_type === car) ? i : -1).filter(i => i >= 0)
}
function replaceRecords(current, indices, replacement) {
  const next = [...current]
  indices.forEach((index, i) => { next[index] = replacement[i] })
  return next
}
function candidateEdits(car, current) {
  const base = { ...pool.baselineProfiles[car], ...current }
  // Target the observed wide entry/exit and Normal reverse traffic failures.
  // These are driver-policy controls, not track or checkpoint exceptions.
  const targeted = car === 'yellow' ? [
    // The remaining misses occur at high speed on wide exits. Test coupled
    // pace/preview/edge corrections rather than another single-axis sweep.
    ...[0.25, 0.35, 0.45].flatMap(hardCornerTargetBonus =>
      [8, 10, 14].flatMap(hardLookAheadSamples =>
        [0.4, 0.8].map(hardEdgeAvoidanceScale => ({
          hardCornerTargetBonus, hardLookAheadSamples, hardEdgeAvoidanceScale,
        })))),
    ...[0.9, 0.95, 1].flatMap(technicalCornerPursuitScale =>
      [2.7, 3.2, 3.5].map(hardSteerGain => ({
        technicalCornerPursuitScale, hardSteerGain, hardReaction: 8,
      }))),
    ...[0, 0.25, 0.5, 0.75].map(hardApexCutScale => ({ hardApexCutScale })),
    ...[0.05, 0.1, 0.15, 0.2].map(hardHairpinReserve => ({ hardHairpinReserve })),
    ...[0.2, 0.3, 0.4].flatMap(hardCornerTargetBonus => [
      { hardCornerTargetBonus, hardApexCutScale: 0.5 },
      { hardCornerTargetBonus, hardLookAheadSamples: 9 },
    ]),
    ...[0.8, 0.9, 1].map(technicalCornerPursuitScale => ({ technicalCornerPursuitScale, hardApexCutScale: 0 })),
  ] : car === 'green' ? [
    ...[0.98, 1, 1.05, 1.1, 1.2].map(lowerDifficultyReserveScale => ({ lowerDifficultyReserveScale })),
    ...[0.92, 0.96, 0.98].map(technicalCornerPaceScale => ({ technicalCornerPaceScale })),
  ] : []
  const variants = [...targeted, ...proposals, ...generateCandidates(car, base, 14).map(x => x.changes)]
  // First pass uses bounded coarse values; subsequent passes refine the
  // accepted combination rather than resetting unrelated parameters.
  if (Object.keys(current).length) {
    for (const key of ['technicalCornerPaceScale', 'technicalCornerPursuitScale']) {
      for (const delta of [-0.05, 0.05]) {
        const value = Math.max(0.5, Math.min(1, (current[key] ?? 1) + delta))
        variants.push({ [key]: Number(value.toFixed(3)) })
      }
    }
  }
  const unique = new Map()
  for (const edits of variants) {
    const profile = { ...current, ...edits }
    if (profileKey({ [car]: profile }) !== profileKey({ [car]: current }))
      unique.set(profileKey({ [car]: profile }), profile)
  }
  return [...unique.values()]
}

try {
  await pool.start()
  const baseline = await simulate(matrix, {}, 'baseline')
  const baselineMetrics = metrics(baseline)
  console.log('RELIABILITY_BASELINE ' + JSON.stringify({ metrics: baselineMetrics, failures: findings(matrix, baseline) }))
  const profiles = {}
  const history = []
  let current = baseline
  let crossCurrent = []
  let crossBaseline = []
  if (!verifyOnly) {
    crossBaseline = await simulate(validation, {}, 'cross-track-baseline')
    crossCurrent = crossBaseline
    // Resume the last measured, cross-track-safe lab result, but revalidate
    // against the original checked-in profiles on this exact revision.
    const seed = {
      yellow: { technicalCornerPaceScale: 0.95, hardHairpinReserve: 0.05 },
      green: { lowerDifficultyReserveScale: 1.2 },
      red: { technicalCornerPursuitScale: 0.85 },
      blue: { hardCornerTargetBonus: 0.12 },
    }
    const seedMatrix = await simulate(matrix, seed, 'resume-seed')
    const seedCross = await simulate(validation, seed, 'resume-cross')
    if (noNewDebt(baseline, seedMatrix) &&
        compareReliability(metrics(seedMatrix), baselineMetrics) < 0 &&
        crossTrackRegressions(crossBaseline, seedCross).length === 0) {
      Object.assign(profiles, seed)
      current = seedMatrix
      crossCurrent = seedCross
      console.log('RELIABILITY_RESUME ' + JSON.stringify({ profiles, metrics: metrics(current) }))
    }
    // Every accepted coordinate is cross-validated BEFORE committing it.
    // Run a second pass automatically if the first one leaves recovery debt.
    for (let round = 1; round <= 2; round++) {
      let changed = false
      for (const car of ['yellow', 'green', 'red', 'blue']) {
        const indices = affected(current, car)
        const crossIndices = affected(crossCurrent, car)
        const cases = indices.map(i => matrix[i])
        const crossCases = crossIndices.map(i => validation[i])
        const old = indices.map(i => current[i])
        const frozen = indices.map(i => baseline[i])
        const frozenCross = crossIndices.map(i => crossBaseline[i])
        const oldCross = crossIndices.map(i => crossCurrent[i])
        let best = { records: old, cross: oldCross, changes: profiles[car] ?? {},
          score: { hairpin: metrics(old), crossTrack: metrics(oldCross) } }
        // Once this car's entire affected matrix is free of recovery debt,
        // do not trade a safe profile for cosmetic single-track speed gains.
        if (compareReliability(best.score.hairpin, { errors: 0, dnf: 0, recoveries: 0 }) === 0) continue
        const edits = candidateEdits(car, profiles[car] ?? {})
        for (const [i, changes] of edits.entries()) {
          const candidate = { ...profiles, [car]: changes }
          const id = round + '-' + car + '-' + i
          const records = await simulate(cases, candidate, id)
          const hairpin = metrics(records)
          if (!noNewDebt(frozen, records) || !noNewDebt(old, records) ||
              compareReliability(hairpin, best.score.hairpin) > 0) {
            history.push({ round, car, changes, eligible: false, hairpin, reason: 'hairpin reliability' })
            continue
          }
          // No expensive cross-track simulation for an edit which does not
          // reduce any of the outstanding target-case failures.
          if (compareReliability(hairpin, metrics(old)) >= 0) {
            history.push({ round, car, changes, eligible: false, hairpin, reason: 'no reliability gain' })
            continue
          }
          const cross = await simulate(crossCases, candidate, id)
          const regressions = crossTrackRegressions(frozenCross, cross)
          const score = { hairpin, crossTrack: metrics(cross) }
          const eligible = regressions.length === 0
          history.push({ round, car, changes, eligible, ...score, regressions })
          if (eligible && compareResults(score, best.score) < 0)
            best = { records, cross, changes, score }
        }
        changed ||= profileKey({ [car]: best.changes }) !== profileKey({ [car]: profiles[car] ?? {} })
        profiles[car] = best.changes
        current = replaceRecords(current, indices, best.records)
        crossCurrent = replaceRecords(crossCurrent, crossIndices, best.cross)
        console.log('RELIABILITY_CAR ' + JSON.stringify({ round, car, changes: best.changes, metrics: metrics(current), crossTrack: metrics(crossCurrent) }))
      }
      const result = metrics(current)
      if (!changed || (result.dnf === 0 && result.recoveries === 0 && result.errors === 0)) break
    }
  }
  // Re-run the selected full roster together, including cases not changed in
  // the coordinate search, and evaluate every rival against the frozen start.
  const combined = verifyOnly ? baseline : await simulate(matrix, profiles, 'combined')
  const after = verifyOnly ? [] : await simulate(validation, profiles, 'cross-track-combined')
  const regressions = verifyOnly ? [] : crossTrackRegressions(crossBaseline, after)
  const final = metrics(combined)
  const accepted = noNewDebt(baseline, combined) && final.errors === 0 && final.dnf === 0 &&
    final.recoveries === 0 && regressions.length === 0
  const report = { accepted, verifyOnly, profiles, baseline: baselineMetrics, combined: final,
    failures: findings(matrix, combined), regressions, history, crossTrackTrials: after.length }
  await mkdir(output, { recursive: true })
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
  console.log('RELIABILITY_RESULT ' + JSON.stringify({ ...report, history: undefined, candidateCount: history.length }))
  if (!accepted) process.exitCode = 1
} finally {
  await pool.close()
}
