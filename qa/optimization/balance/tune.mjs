import { DEFAULT_CARS, generateCandidates } from '../candidates.mjs'
import { assessCandidate, compareScores, trialKey } from '../score.mjs'

/** Offline policy search: calibration selects exactly one profile per car;
 * holdout simulations only measure those frozen profiles. */
export async function tuneBalance({ pool, scenarios, holdoutScenarios, seeds, trials, baselines = [] }) {
  if (!pool.baselineProfiles) throw new Error('Simulation pool has not published baseline profiles')
  if (!scenarios.length || !holdoutScenarios.length || !seeds.length)
    throw new Error('Calibration, held-out scenarios and seeds are required')
  const calibrationIds = new Set(scenarios.map(x => x.id))
  if (holdoutScenarios.some(x => calibrationIds.has(x.id)))
    throw new Error('Calibration and held-out scenarios must be disjoint')
  const available = Object.fromEntries(DEFAULT_CARS.map(car => [car,
    generateCandidates(car, pool.baselineProfiles[car], trials)]))
  const attemptedPerCar = Math.min(...DEFAULT_CARS.map(car => available[car].length))
  if (!attemptedPerCar) throw new Error('No candidate profiles available for every car')
  const records = []
  const baselineMap = baselines instanceof Map ? baselines : new Map(baselines.map(({ task, result }) => [trialKey(task), result]))
  const cachedBaseline = new Map()
  const taskFor = (car, scenario, seed, mode, candidate, focusRole = 'player', playerCar = car) => ({
    car, playerCar, focusRole, scenarioId: scenario.id, seed, mode, difficulty: 'hard',
    policyKind: 'driving', candidateId: candidate.id, changes: candidate.changes,
  })
  function run(task, baseline = false) {
    const key = trialKey(task)
    const supplied = baseline ? baselineMap.get(key) : undefined
    if (supplied) return Promise.resolve(supplied.result ?? supplied)
    if (baseline && cachedBaseline.has(key)) return cachedBaseline.get(key)
    const pending = pool.submit(task).then(result => {
      if (!result) throw new Error(`Missing result for ${key}`)
      records.push({ task, result })
      return result
    })
    if (baseline) cachedBaseline.set(key, pending)
    return pending
  }
  const base = car => ({ id: `balance-base-${car}`, changes: {} })
  const calibrationCases = (car, candidate) => scenarios.flatMap(scenario =>
    seeds.map(seed => taskFor(car, scenario, seed, 'solo', candidate)))
  const calibrationBaselines = new Map()
  await Promise.all(DEFAULT_CARS.flatMap(car => calibrationCases(car, base(car)).map(async task => {
    calibrationBaselines.set(trialKey(task), await run(task, true))
  })))
  const candidates = await Promise.all(DEFAULT_CARS.flatMap(car => available[car].slice(0, attemptedPerCar).map(async candidate => {
    const tasks = calibrationCases(car, candidate)
    const results = await Promise.all(tasks.map(task => run(task)))
    const score = assessCandidate(tasks.map((task, i) => [calibrationBaselines.get(trialKey(task)), results[i]]))
    return { ...candidate, score }
  })))
  const selected = DEFAULT_CARS.map(car => candidates.filter(candidate => candidate.car === car && candidate.score.eligible)
    .sort((a, b) => compareScores(a.score, b.score))[0] ?? null)
  const selectedChanges = Object.fromEntries(DEFAULT_CARS.map((car, i) => [car, selected[i]?.changes ?? {}]))
  const rivals = { red: 'green', green: 'red', blue: 'red', yellow: 'yellow' }
  const cases = car => holdoutScenarios.flatMap(scenario => seeds.flatMap(seed => [
    { scenario, seed, mode: 'solo', role: 'player', player: car },
    { scenario, seed, mode: 'traffic', role: 'player', player: car },
    { scenario, seed, mode: 'traffic', role: 'rival', player: rivals[car] },
  ]))
  const perCar = await Promise.all(DEFAULT_CARS.map(async (car, index) => {
    const candidate = selected[index]
    if (!candidate) return { car, selected: null, validation: null }
    const pairs = await Promise.all(cases(car).map(async ({ scenario, seed, mode, role, player }) => {
      const before = taskFor(car, scenario, seed, mode, base(car), role, player)
      const after = taskFor(car, scenario, seed, mode, candidate, role, player)
      return Promise.all([run(before, true), run(after)])
    }))
    return { car, selected: candidate, validation: assessCandidate(pairs, { requireBenefit: false }) }
  }))
  // Combined overrides must be simulated together: rivals can interact.
  const combinedPairs = await Promise.all(DEFAULT_CARS.flatMap(car => cases(car).map(async ({ scenario, seed, mode, role, player }) => {
    const before = taskFor(car, scenario, seed, mode, base(car), role, player)
    const after = { ...taskFor(car, scenario, seed, mode, { id: `balance-combined-${car}`, changes: {} }, role, player),
      profileOverrides: selectedChanges }
    return Promise.all([run(before, true), run(after)])
  })))
  return { requestedPerCar: trials, availablePerCar: Object.fromEntries(DEFAULT_CARS.map(car => [car, available[car].length])),
    attemptedPerCar, candidates, selectedChanges, perCar,
    combined: assessCandidate(combinedPairs, { requireBenefit: false }), records }
}
