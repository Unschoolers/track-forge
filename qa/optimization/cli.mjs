#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { SimulationPool } from './pool.mjs'
import { generateCandidates, DEFAULT_CARS } from './candidates.mjs'
import { generatePassingCandidates } from './passingCandidates.mjs'
import { STUDY_SCENARIOS, selectScenarios } from './scenarios.mjs'
import { trialKey, assessCandidate, evaluatePair, compareScores, assessFleet, PHYSICS_ACCEPTANCE } from './score.mjs'
import { jsonLines } from './records.mjs'

function options(args) {
  const take = (key, fallback) => {
    const i = args.indexOf('--' + key)
    return i === -1 ? fallback : args[i + 1]
  }
  const cars = take('cars', DEFAULT_CARS.join(',')).split(',').filter(Boolean)
  const workers = Number(take('workers', Math.min(3, Math.max(1, availableParallelism() - 1))))
  const focus = take('focus', 'driving')
  const trials = Number(take('trials', 14))
  const seeds = take('seeds', '1,4331').split(',').map(Number)
  const out = resolve(take('out', focus === 'balance' ? 'qa/results/balance' : 'qa/results/optimization'))
  const tune = args.includes('--tune')
  const scenarioIds = take('scenarios', STUDY_SCENARIOS.map(x => x.id).join(',')).split(',')
  const baselineOnly = args.includes('--baseline-only')
  const behaviorPreserving = args.includes('--behavior-preserving')
  const reference = take('reference', null)
  const gameplayImprovement = args.includes('--gameplay-improvement')
  if (args.includes('--help')) return { help: true }
  if (cars.some(car => !DEFAULT_CARS.includes(car)) || new Set(cars).size !== cars.length || !cars.length)
    throw new Error('Invalid --cars: expected unique red,green,blue,yellow')
  if (!['driving', 'passing', 'balance'].includes(focus))
    throw new Error('--focus must be driving, passing or balance')
  if (!Number.isInteger(workers) || workers < 1 || workers > 8)
    throw new Error('--workers must be 1..8')
  if (!Number.isInteger(trials) || trials < 1 || trials > 100)
    throw new Error('--trials must be 1..100 per car')
  if (!seeds.length || new Set(seeds).size !== seeds.length ||
      seeds.some(x => !Number.isInteger(x) || x < 0 || x > 0xffffffff))
    throw new Error('--seeds requires nonnegative integers')
  if (reference && (baselineOnly || focus !== 'driving'))
    throw new Error('--reference is for driving recalibration only')
  if (gameplayImprovement && !reference) throw new Error('--gameplay-improvement requires a matched reference')
  const holdoutFiles = args.flatMap((arg, i) => arg === '--holdout-track' ? [args[i + 1]] : [])
  if (holdoutFiles.some(file => !file || file.startsWith('--')) || new Set(holdoutFiles).size !== holdoutFiles.length)
    throw new Error('--holdout-track requires distinct track JSON paths')
  if ((tune && focus !== 'balance') || (holdoutFiles.length && !tune))
    throw new Error('--tune and --holdout-track are for balance tuning only')
  if (focus === 'balance' && (args.includes('--cars') || args.includes('--scenarios') || (tune && baselineOnly)))
    throw new Error('Balance uses all four cars and the fixed six benchmark scenarios')
  if (behaviorPreserving && (reference || focus !== 'driving'))
    throw new Error('--behavior-preserving is for driving comparisons without recalibration')
  return { cars, focus, workers, trials, seeds, out, scenarioIds, baselineOnly, reference, gameplayImprovement, behaviorPreserving, tune, holdoutFiles,
    sampleTelemetry: !args.includes('--no-telemetry') }
}

const args = options(process.argv.slice(2))
if (args.help) {
  console.log('Usage: npm run qa:optimize -- [--focus driving|passing|balance] [--cars red,green,blue,yellow]' +
    ' [--workers 2] [--trials 14] [--seeds 1,4331]' +
    ' [--scenarios pine-hairpins,desert-reverse] [--baseline-only] [--reference baseline-results.json] [--gameplay-improvement] [--behavior-preserving]' +
    ' [--out qa/results/optimization] [--no-telemetry]')
  console.log('Balance: npm run qa:optimize -- --focus balance [--tune [--trials 14] [--holdout-track file.json]] [--out qa/results/balance]')
} else if (args.focus === 'balance') {
  const { runBalance } = await import('./balance/runner.mjs')
  await runBalance(args)
} else {
  const scenarios = selectScenarios(args.scenarioIds)
  const calibration = scenarios.filter(x => x.group === 'calibration')
  const reference = args.reference ? JSON.parse(await readFile(resolve(args.reference), 'utf8')) : null
  const referenceRuns = new Map((reference ?? []).map(item => [trialKey(item.task), item.result]))
  if (reference && referenceRuns.size !== reference.length) throw new Error('Duplicate reference trials')
  function referenceFor(task) {
    const result = referenceRuns.get(trialKey(task))
    if (!result) throw new Error('Missing original-physics reference: ' + trialKey(task))
    return result
  }
  if (!args.baselineOnly && !calibration.length)
    throw new Error('A driving/passing search requires a calibration scenario')
  const physicsRevision = process.env.GITHUB_SHA ?? 'local'
  const pool = new SimulationPool({
    workers: args.workers, scenarios, physicsRevision,
  })
  const records = []
  const cache = new Map()
  const began = performance.now()
  async function batch(tasks, stage) {
    if (!tasks.length) return
    console.log(`${stage}: ${tasks.length} independent simulation trials / ${args.workers} workers`)
    const runs = await Promise.all(tasks.map(task => pool.submit(task)))
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      const result = runs[i]
      if (!task || !result) throw new Error('Missing completed simulation')
      const key = `${task.candidateId}/${trialKey(task)}`
      if (cache.has(key)) throw new Error(`Duplicate simulation: ${key}`)
      cache.set(key, { task, result })
      records.push({ task, result })
    }
  }
  function get(candidateId, task) {
    const found = cache.get(`${candidateId}/${trialKey(task)}`)
    if (!found) throw new Error(`Missing matched trial: ${candidateId} / ${trialKey(task)}`)
    return found.result
  }
  // Real moving opponent, intentionally slower, so every chassis gets
  // a meaningful chance to overtake during calibration (especially Yellow).
  const duelOpponentSpeedLimit = 220
  function trial(car, scenario, seed, mode, candidate, playerCar = car, focusRole = 'player', opponentCar, opponentSpeedLimit) {
    return {
      car, playerCar, focusRole, scenarioId: scenario.id, seed, mode, difficulty: 'hard',
      policyKind: args.focus, ...(opponentCar ? { opponentCar } : {}),
      ...(opponentSpeedLimit !== undefined ? { duelOpponentSpeedLimit: opponentSpeedLimit } : {}),
      ...(args.behaviorPreserving && candidate.id === `base-${car}` ? { telemetry: true } : {}),
      candidateId: candidate.id, changes: candidate.changes,
    }
  }

  try {
    await pool.start()
    const profiles = args.focus === 'passing' ? pool.passingProfiles : pool.baselineProfiles
    if (!profiles) throw new Error('Simulator did not publish AI profiles')
    const baselines = args.cars.map(car => ({ id: `base-${car}`, car, changes: {} }))
    const candidates = args.baselineOnly ? [] : args.cars.flatMap(car => args.focus === 'passing'
      ? generatePassingCandidates(car, profiles[car], args.trials)
      : generateCandidates(car, profiles[car], args.trials))
    const duelOpponents = { red: 'green', green: 'red', blue: 'red', yellow: 'green' }
    const screeningTask = (candidate, scenario) => trial(
      candidate.car, scenario, args.seeds[0],
      args.focus === 'passing' ? 'duel' : 'solo', candidate,
      candidate.car, 'player',
      args.focus === 'passing' ? duelOpponents[candidate.car] : undefined,
      args.focus === 'passing' ? duelOpponentSpeedLimit : undefined,
    )
    const baselineTasks = baselines.flatMap(base =>
      calibration.map(scenario => screeningTask(base, scenario)))
    await batch(baselineTasks, 'calibration baselines')
    const candidateTasks = candidates.flatMap(candidate =>
      calibration.map(scenario => screeningTask(candidate, scenario)))
    await batch(candidateTasks, 'parallel bounded search')

    const screening = candidates.map(candidate => {
      const baseId = `base-${candidate.car}`
      const pairs = calibration.map(scenario => {
        const task = screeningTask(candidate, scenario)
        return [get(baseId, task), get(candidate.id, task)]
      })
      return { ...candidate, score: assessCandidate(pairs, {
        requireBenefit: !reference,
      }) }
    })
    const shortlisted = args.cars.flatMap(car =>
      screening.filter(x => x.car === car && (args.reference || x.score.eligible))
        .sort((a, b) => compareScores(a.score, b.score)).slice(0, args.reference ? args.trials : 2))
    console.log('shortlist: ' + JSON.stringify(shortlisted.map(x => ({
      car: x.car, id: x.id, changes: x.changes,
      calibrationGainPct: Number((100 * x.score.improvement).toFixed(3)),
    }))))

    // Validation includes the *calibration* circuits under traffic plus
    // held-out scenarios, two deterministic seeds, and identical rival grids.
    // Hard mirrors the player car and omits one other colour. Yellow can
    // only appear as a rival when Yellow occupies the player slot.
    const opponents = { red: 'green', green: 'red', blue: 'red', yellow: 'yellow' }
    const allCasesFor = car => scenarios.flatMap(scenario =>
      args.seeds.flatMap(seed => [
        { scenario, seed, mode: 'solo', playerCar: car, focusRole: 'player' },
        ...(args.focus === 'passing' ? [{
          scenario, seed, mode: 'duel', playerCar: car, focusRole: 'player',
          opponentCar: duelOpponents[car], duelOpponentSpeedLimit,
        }] : []),
        { scenario, seed, mode: 'traffic', playerCar: car, focusRole: 'player' },
        { scenario, seed, mode: 'traffic', playerCar: opponents[car], focusRole: 'rival' },
      ]))

    const baseMore = baselines.flatMap(base => allCasesFor(base.car)
      .map(({ scenario, seed, mode, playerCar, focusRole, opponentCar, duelOpponentSpeedLimit }) => trial(base.car, scenario, seed, mode, base, playerCar, focusRole, opponentCar, duelOpponentSpeedLimit))
      .filter(task => !cache.has(`${task.candidateId}/${trialKey(task)}`)))
    await batch(baseMore, 'full-field baselines')
    const finalistTasks = shortlisted.flatMap(candidate => allCasesFor(candidate.car)
      .map(({ scenario, seed, mode, playerCar, focusRole, opponentCar, duelOpponentSpeedLimit }) => trial(candidate.car, scenario, seed, mode, candidate, playerCar, focusRole, opponentCar, duelOpponentSpeedLimit))
      .filter(task => !cache.has(`${task.candidateId}/${trialKey(task)}`)))
    await batch(finalistTasks, 'cross-track solo + traffic validation')

    const validation = (reference ? [...baselines, ...shortlisted] : shortlisted).map(candidate => {
      const pairs = allCasesFor(candidate.car).map(({ scenario, seed, mode, playerCar, focusRole, opponentCar, duelOpponentSpeedLimit }) => {
        const task = trial(candidate.car, scenario, seed, mode, candidate, playerCar, focusRole, opponentCar, duelOpponentSpeedLimit)
        return [reference ? referenceFor(task) : get(`base-${candidate.car}`, task), get(candidate.id, task)]
      })
      return { ...candidate, score: assessCandidate(pairs, {
        ...(reference ? PHYSICS_ACCEPTANCE : {}),
      }) }
    })
    const winners = validation.filter(row => row.score.eligible)
      .sort((a, b) => compareScores(a.score, b.score))
    const best = winners.find(row => Object.keys(row.changes).length > 0) ?? null
    const perCarWinners = args.cars.flatMap(car => winners.filter(row => row.car === car).slice(0, 1))
    const combinedChanges = Object.fromEntries(perCarWinners.map(row => [row.car, row.changes]))
    const combinedTasks = reference ? args.cars.flatMap(car => allCasesFor(car).map(({ scenario, seed, mode, playerCar, focusRole, opponentCar, duelOpponentSpeedLimit }) => ({
      ...trial(car, scenario, seed, mode, { id: `combined-${car}`, changes: {} }, playerCar, focusRole, opponentCar, duelOpponentSpeedLimit),
      profileOverrides: combinedChanges,
    }))) : []
    await batch(combinedTasks, 'combined per-car profile validation')
    const combinedComparisons = combinedTasks.map(task => evaluatePair(referenceFor(task), get(task.candidateId, task), {
      ...PHYSICS_ACCEPTANCE,
    }))
    const combinedAcceptance = reference ? assessFleet(combinedComparisons, { gameplayImprovement: args.gameplayImprovement }) : null
    if (reference) console.log('AI_RECALIBRATION_RESULT ' + JSON.stringify({
      perCarWinners: perCarWinners.map(row => ({ car: row.car, changes: row.changes, gainPercent: 100 * row.score.improvement, recoveriesReduced: row.score.recoveriesReduced })),
      combinedFailures: combinedComparisons.filter(row => !row.eligible),
      combinedComparisons: combinedComparisons.length, acceptance: combinedAcceptance,
    }))
    const reports = screening.map(x => ({
      id: x.id, car: x.car, changes: x.changes,
      calibration: { eligible: x.score.eligible,
        gainPercent: Number((x.score.improvement * 100).toFixed(3)),
        rejectedReasons: x.score.rejectedReasons },
      validation: (() => {
        const value = validation.find(v => v.id === x.id)
        if (!value) return null
        return {
          eligible: value.score.eligible,
          gainPercent: Number((value.score.improvement * 100).toFixed(3)),
          rejectedReasons: value.score.rejectedReasons,
          comparisons: value.score.comparisons,
        }
      })(),
    }))
    const matrix = args.cars.flatMap(car => allCasesFor(car).map(({ scenario, seed, mode, playerCar, focusRole, opponentCar, duelOpponentSpeedLimit }) => {
      const task = trial(car, scenario, seed, mode, { id: `base-${car}`, changes: {} }, playerCar, focusRole, opponentCar, duelOpponentSpeedLimit)
      const run = get(`base-${car}`, task)
      const driver = run.rows.find(row => row.vehicle_id === run.focusVehicleId)
      if (!driver) throw new Error('Missing baseline driver row')
      return { car, playerCar, focusRole, opponentCar: opponentCar ?? null,
        duelOpponentSpeedLimit: duelOpponentSpeedLimit ?? null,
        scenarioId: scenario.id, seed, mode,
        seconds: driver.finished_seconds, recoveries: driver.recoveries }
    }))
    const result = {
      schemaVersion: 1,
      physicsRevision, focus: args.focus, cars: args.cars, seeds: args.seeds,
      workers: args.workers, trialsPerCar: args.baselineOnly ? 0 : args.trials,
      scenarios, baselineMatrix: matrix, candidates: reports,
      ...(reference ? { recalibration: { combinedChanges, combinedComparisons, acceptance: combinedAcceptance } } : {}),
      recommendation: best ? {
        car: best.car, changes: best.changes, candidateId: best.id,
        matchedGainPercent: Number((best.score.improvement * 100).toFixed(3)),
        recoveriesReduced: best.score.recoveriesReduced,
        comparisons: best.score.comparisons,
        status: 'requires final production regression gates',
      } : null,
      elapsedMs: Math.round(performance.now() - began),
    }
    if (best && args.sampleTelemetry) {
      // Collect high-resolution diagnostics only for the recommended policy.
      // The scoring dataset is lightweight; telemetry is for investigation.
      const desert = scenarios.find(x => x.id === 'desert-reverse')
      if (desert) {
        const baseline = { id: `telemetry-base-${best.car}`, car: best.car, changes: {} }
        const winner = { ...best, id: `telemetry-${best.id}` }
        await batch([baseline, winner].map(c =>
          ({ ...trial(best.car, desert, args.seeds[0], 'solo', c), telemetry: true })),
        'winner detailed telemetry')
      }
    }
    await mkdir(args.out, { recursive: true })
    await writeFile(resolve(args.out, 'baseline-results.json'), JSON.stringify(records.filter(({ task }) => task.candidateId === `base-${task.car}`).map(({ task, result }) => ({ task,
      result: { ...result, samples: args.behaviorPreserving ? result.samples : [] } }))))
    await Promise.all([
      writeFile(resolve(args.out, 'summary.json'), JSON.stringify(result, null, 2) + '\n'),
      writeFile(resolve(args.out, 'runs.jsonl'),
        jsonLines(records.flatMap(item => item.result.rows))),
      writeFile(resolve(args.out, 'events.jsonl'),
        jsonLines(records.flatMap(item => item.result.events))),
      writeFile(resolve(args.out, 'telemetry.jsonl'),
        jsonLines(records.flatMap(item => item.result.samples))),
    ])
    if (reference && !combinedAcceptance.eligible) process.exitCode = 1
    console.log('AI_OPTIMIZER_RESULT ' + JSON.stringify({
      recommendation: result.recommendation &&
        { car: result.recommendation.car, changes: result.recommendation.changes,
          matchedGainPercent: result.recommendation.matchedGainPercent },
      trials: records.length,
      rejected: validation.filter(x => !x.score.eligible).map(x => ({
        car: x.car, id: x.id, reasons: x.score.rejectedReasons.slice(0, 4),
      })),
      elapsedMs: result.elapsedMs,
      output: args.out,
    }))
  } finally {
    await pool.close()
  }
}
