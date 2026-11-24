/** Recovery non-regression is a hard gate; timing is secondary. */
export const PHYSICS_ACCEPTANCE = Object.freeze({
  maxSlowdownSeconds: 1, requireBenefit: false, allowPhysicsRevisionChange: true,
})

const NEUTRAL_SECONDS = 0.1
const EPSILON = 1e-9

export function compareScores(a, b) {
  return b.recoveriesReduced - a.recoveriesReduced || b.meanGainSeconds - a.meanGainSeconds
}
export function trialKey(task) {
  return [task.car, task.playerCar ?? task.car, task.focusRole ?? 'player',
    task.policyKind ?? 'driving', task.opponentCar ?? 'none',
    task.duelOpponentSpeedLimit ?? 'default', 
    task.scenarioId, task.seed, task.difficulty, task.mode].join('|')
}
function driver(record) {
  return record.rows.find(row => row.vehicle_id === (record.focusVehicleId ?? record.driverVehicleId))
}

export function evaluatePair(baseline, candidate, { maxSlowdownSeconds = 1, allowPhysicsRevisionChange = false, requireZeroRecoveries = false } = {}) {
  const old = driver(baseline)
  const current = driver(candidate)
  if (!old || !current || old.car_type !== current.car_type)
    throw new Error('Missing comparable driver row')
  if (old.track_fingerprint !== current.track_fingerprint ||
      old.seed !== current.seed || old.mode !== current.mode ||
      old.difficulty !== current.difficulty || old.start_ratio !== current.start_ratio ||
      old.reversed !== current.reversed || old.laps_requested !== current.laps_requested ||
      (!allowPhysicsRevisionChange && old.physics_revision !== current.physics_revision) ||
      old.driver_car !== current.driver_car ||
      old.tuned_car !== current.tuned_car ||
      old.grid_positions !== current.grid_positions ||
      old.focus_role !== current.focus_role ||
      old.policy_kind !== current.policy_kind ||
      old.duel_opponent_car !== current.duel_opponent_car ||
      old.duel_opponent_speed_limit !== current.duel_opponent_speed_limit)
    throw new Error('Non-comparable simulations: context mismatch')

  const reasons = []
  if (old.finished_seconds === null)
    reasons.push('baseline did not finish')
  if (current.finished_seconds === null)
    reasons.push('candidate did not finish')
  if (requireZeroRecoveries && current.recoveries > 0)
    reasons.push(`driver recovered ${current.recoveries} times`)
  // Recovery events are still errors in raw telemetry. The matched count gate
  // permits existing debt only, never a new recovery or unrelated engine error.
  const recoveryEvents = record => {
    const counts = new Map()
    for (const event of record.events) {
      if (event.severity !== 'error' || event.code !== 'recovery') continue
      counts.set(event.vehicle_id, (counts.get(event.vehicle_id) ?? 0) + 1)
    }
    return counts
  }
  const oldRecoveryEvents = recoveryEvents(baseline)
  const newRecoveryEvents = recoveryEvents(candidate)
  if (candidate.events.some(event => event.severity === 'error' && event.code !== 'recovery'))
    reasons.push('simulation error event')
  for (const [id, count] of newRecoveryEvents) {
    const row = candidate.rows.find(row => row.vehicle_id === id)
    if (!row || count > row.recoveries || count > (oldRecoveryEvents.get(id) ?? 0))
      reasons.push(`new or unaccounted recovery event: ${id}`)
  }
  // Traffic cannot be "optimized" by forcing competitors off the road.
  const oldRivals = new Map(baseline.rows.map(row => [row.vehicle_id, row]))
  const newRivals = new Map(candidate.rows.map(row => [row.vehicle_id, row]))
  if (oldRivals.size !== baseline.rows.length || newRivals.size !== candidate.rows.length || oldRivals.size !== newRivals.size)
    reasons.push('roster changed')
  let recoveriesReduced = 0;
  for (const rival of candidate.rows) {
    const prior = oldRivals.get(rival.vehicle_id)
    if (!prior) { reasons.push('roster changed'); continue }
    if (rival.car_type !== prior.car_type) reasons.push('roster changed')
    recoveriesReduced += prior.recoveries - rival.recoveries
    if (rival.recoveries > prior.recoveries)
      reasons.push(`new ${rival.car_type} recovery`)
    if (rival.finished_seconds === null && prior.finished_seconds !== null)
      reasons.push(`${rival.car_type} no longer finishes`)
  }
  const improvement = old.finished_seconds === null || current.finished_seconds === null
    ? null : (old.finished_seconds - current.finished_seconds) / old.finished_seconds
  const gainSeconds = improvement === null ? null : old.finished_seconds - current.finished_seconds
  const requiresReview = gainSeconds !== null && gainSeconds < -maxSlowdownSeconds - EPSILON
  const hardFailure = reasons.length > 0
  if (requiresReview) reasons.push(`slower by ${(-gainSeconds).toFixed(3)}s; manual review required`)
  return {
    eligible: !hardFailure && !requiresReview, hardFailure, requiresReview, reasons,
    improvement, gainSeconds, recoveriesReduced, before: old.finished_seconds, after: current.finished_seconds,
    scenarioId: current.scenario_id, mode: current.mode, seed: current.seed,
    playerCar: current.driver_car, focusRole: current.focus_role,
    car: current.car_type,
    recoveriesBefore: old.recoveries, recoveriesAfter: current.recoveries,
    offroadBefore: old.offroad_seconds, offroadAfter: current.offroad_seconds,
  }
}

/**
 * A reviewed timing-only regression may pass the release comparison.
 * Never use a review to select tuning candidates or suppress engine errors.
 * Bind the review to a frozen baseline and exact matched trial identity.
 */
export function applyTimingReview(pair, task, review, baselineRevision) {
  if (!pair.requiresReview || pair.hardFailure || !review ||
      review.baselineRevision !== baselineRevision || pair.gainSeconds === null) return pair
  const approval = review.approvals.find(entry => entry.trial === trialKey(task))
  if (!approval || !Number.isFinite(approval.maxSlowdownSeconds) ||
      !Number.isFinite(approval.beforeSeconds) ||
      Math.abs(pair.before - approval.beforeSeconds) > EPSILON ||
      -pair.gainSeconds > approval.maxSlowdownSeconds + EPSILON ||
      pair.recoveriesAfter !== 0 || pair.recoveriesBefore !== 0 ||
      pair.recoveriesReduced < 0) return pair
  return { ...pair, eligible: true, requiresReview: false, timingReview: {
    approved: true, reason: review.reason, maxSlowdownSeconds: approval.maxSlowdownSeconds,
  } }
}

/** Give each car equal weight, regardless of its number of matched trials. */
export function assessFleet(comparisons, { gameplayImprovement = false, requireBenefit = true } = {}) {
  if (!comparisons.length) throw new Error('No comparison trials')
  const cars = [...new Set(comparisons.map(row => row.car))].map(car => {
    const rows = comparisons.filter(row => row.car === car)
    const valid = rows.filter(row => row.gainSeconds !== null)
    const meanGainSeconds = valid.length ? valid.reduce((sum, row) => sum + row.gainSeconds, 0) / valid.length : 0
    return { car, meanGainSeconds, trials: rows.length,
      recoveriesBefore: rows.reduce((sum, row) => sum + row.recoveriesBefore, 0),
      recoveriesAfter: rows.reduce((sum, row) => sum + row.recoveriesAfter, 0) }
  })
  const meanGainSeconds = cars.reduce((sum, row) => sum + row.meanGainSeconds, 0) / cars.length
  const recoveriesReduced = comparisons.reduce((sum, row) => sum + row.recoveriesReduced, 0)
  const hardFailure = comparisons.some(row => row.hardFailure)
  const requiresReview = comparisons.some(row => row.requiresReview)
  const hasBenefit = recoveriesReduced > 0 || meanGainSeconds > NEUTRAL_SECONDS + EPSILON || gameplayImprovement
  const decision = hardFailure ? 'reject' : requiresReview ? 'manual-review'
    : !requireBenefit || hasBenefit ? 'accept' : 'no-benefit'
  return { eligible: decision === 'accept', decision, cars, meanGainSeconds, recoveriesReduced, gameplayImprovement, hasBenefit }
}

export function assessCandidate(pairs, options = {}) {
  if (!pairs.length) throw new Error('No comparison trials')
  const comparisons = pairs.map(([before, after]) => evaluatePair(before, after, options))
  const fleet = assessFleet(comparisons, options)
  const improvement = comparisons.reduce((sum, x) => sum + (x.improvement ?? 0), 0) / comparisons.length
  return { ...fleet, improvement, comparisons,
    rejectedReasons: [...comparisons.flatMap(x => x.reasons),
      ...(fleet.decision === 'no-benefit' ? ['no meaningful pace, recovery or gameplay improvement'] : [])] }
}
