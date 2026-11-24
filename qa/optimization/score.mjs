/** Recovery non-regression is a hard gate; timing is secondary. */
export const PHYSICS_ACCEPTANCE = Object.freeze({
  maxSlowdown: 0.02, minGain: null, allowPhysicsRevisionChange: true,
})

export function compareScores(a, b) {
  return b.recoveriesReduced - a.recoveriesReduced || b.improvement - a.improvement
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

export function evaluatePair(baseline, candidate, { maxSlowdown = 0.01, allowPhysicsRevisionChange = false, requireZeroRecoveries = false } = {}) {
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
  const allowedSlowdown = recoveriesReduced > 0 ? Math.max(maxSlowdown, 0.02) : maxSlowdown
  if (improvement !== null && improvement < -allowedSlowdown)
    reasons.push(`slower by ${(-100 * improvement).toFixed(2)}%`)
  return {
    eligible: reasons.length === 0, reasons,
    improvement, recoveriesReduced, before: old.finished_seconds, after: current.finished_seconds,
    scenarioId: current.scenario_id, mode: current.mode, seed: current.seed,
    playerCar: current.driver_car, focusRole: current.focus_role,
    car: current.car_type,
    recoveriesBefore: old.recoveries, recoveriesAfter: current.recoveries,
    offroadBefore: old.offroad_seconds, offroadAfter: current.offroad_seconds,
  }
}

export function assessCandidate(pairs, { minGain = 0.005, maxSlowdown = 0.01, allowPhysicsRevisionChange = false, requireZeroRecoveries = false } = {}) {
  if (!pairs.length) throw new Error('No comparison trials')
  const scored = pairs.map(([before, after]) => evaluatePair(before, after, { maxSlowdown, allowPhysicsRevisionChange, requireZeroRecoveries }))
  const failures = scored.filter(row => !row.eligible)
  const improvement = scored.reduce((sum, x) => sum + (x.improvement ?? 0), 0) / scored.length
  const recoveriesReduced = scored.reduce((sum, row) => sum + row.recoveriesReduced, 0)
  if (minGain !== null && recoveriesReduced <= 0 && improvement < minGain) failures.push({
    reasons: [`average improvement ${(100 * improvement).toFixed(2)}% below ${(100 * minGain).toFixed(2)}%`],
  })
  return { eligible: failures.length === 0, improvement, recoveriesReduced, comparisons: scored,
    rejectedReasons: failures.flatMap(x => x.reasons) }
}
