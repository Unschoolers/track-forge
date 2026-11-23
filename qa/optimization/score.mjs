import { recoveryRegression } from './recoveryPolicy.mjs'

/** Safety is a hard gate; timing is compared only for like-for-like trials. */
export function trialKey(task) {
  return [task.car, task.playerCar ?? task.car, task.focusRole ?? 'player',
    task.scenarioId, task.seed, task.difficulty, task.mode].join('|')
}
function driver(record) {
  return record.rows.find(row => row.vehicle_id === (record.focusVehicleId ?? record.driverVehicleId))
}

export function evaluatePair(baseline, candidate, { maxSlowdown = 0.01 } = {}) {
  const old = driver(baseline)
  const current = driver(candidate)
  if (!old || !current || old.car_type !== current.car_type)
    throw new Error('Missing comparable driver row')
  if (old.track_fingerprint !== current.track_fingerprint ||
      old.seed !== current.seed || old.mode !== current.mode ||
      old.difficulty !== current.difficulty || old.start_ratio !== current.start_ratio ||
      old.reversed !== current.reversed || old.laps_requested !== current.laps_requested ||
      old.physics_revision !== current.physics_revision ||
      old.driver_car !== current.driver_car ||
      old.tuned_car !== current.tuned_car ||
      old.grid_positions !== current.grid_positions ||
      old.focus_role !== current.focus_role)
    throw new Error('Non-comparable simulations: context mismatch')

  const reasons = []
  if (old.finished_seconds === null)
    reasons.push('baseline did not finish')
  if (current.finished_seconds === null)
    reasons.push('candidate did not finish')
  const driverRecovery = recoveryRegression(
    current.difficulty, old.recoveries, current.recoveries)
  if (driverRecovery) reasons.push(driverRecovery)
  // Lane monitoring labels an *expected* automatic recovery as an error
  // event. Its allowed count is governed above; other invalid physics,
  // route jumps and timeouts remain unconditional blockers.
  if (candidate.events.some(event =>
    event.severity === 'error' && event.code !== 'recovery'))
    reasons.push('simulation error event')
  // Traffic cannot be "optimized" by forcing competitors off the road.
  const oldRivals = new Map(baseline.rows.map(row => [row.vehicle_id, row]))
  for (const rival of candidate.rows) {
    const prior = oldRivals.get(rival.vehicle_id)
    if (!prior) { reasons.push('roster changed'); continue }
    // An unchanged rival's old recovery must not veto a policy. Extra
    // recovery is evaluated against the same matched difficulty and seed.
    if (rival.vehicle_id !== current.vehicle_id) {
      const rivalRecovery = recoveryRegression(
        current.difficulty, prior.recoveries, rival.recoveries)
      // Hard rivals can already fail in the baseline; flag only a *new*
      // incident for rivals not under this candidate's policy.
      if (rivalRecovery && (current.difficulty !== 'hard' ||
          rival.recoveries > prior.recoveries))
        reasons.push(`${rival.car_type}: ${rivalRecovery}`)
    }
    if (rival.finished_seconds === null && prior.finished_seconds !== null)
      reasons.push(`${rival.car_type} no longer finishes`)
  }
  const improvement = old.finished_seconds === null || current.finished_seconds === null
    ? null : (old.finished_seconds - current.finished_seconds) / old.finished_seconds
  if (improvement !== null && improvement < -maxSlowdown)
    reasons.push(`slower by ${(-100 * improvement).toFixed(2)}%`)
  return {
    eligible: reasons.length === 0, reasons,
    improvement, before: old.finished_seconds, after: current.finished_seconds,
    scenarioId: current.scenario_id, mode: current.mode, seed: current.seed,
    playerCar: current.driver_car, focusRole: current.focus_role,
    car: current.car_type,
    recoveriesBefore: old.recoveries, recoveriesAfter: current.recoveries,
    offroadBefore: old.offroad_seconds, offroadAfter: current.offroad_seconds,
  }
}

export function assessCandidate(pairs, { minGain = 0.005, maxSlowdown = 0.01 } = {}) {
  if (!pairs.length) throw new Error('No comparison trials')
  const scored = pairs.map(([before, after]) => evaluatePair(before, after, { maxSlowdown }))
  const failures = scored.filter(row => !row.eligible)
  const improvement = scored.reduce((sum, x) => sum + (x.improvement ?? 0), 0) / scored.length
  if (improvement < minGain) failures.push({
    reasons: [`average improvement ${(100 * improvement).toFixed(2)}% below ${(100 * minGain).toFixed(2)}%`],
  })
  return { eligible: failures.length === 0, improvement, comparisons: scored,
    rejectedReasons: failures.flatMap(x => x.reasons) }
}
