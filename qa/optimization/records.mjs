/**
 * Stable tabular diagnostics for offline AI optimization.
 * Dataset contract v1: one row per vehicle/trial, zero or more issue/telemetry rows.
 * No game runtime dependency and no requirement to install DuckDB.
 */
export const DIAGNOSTIC_SCHEMA_VERSION = 1

function validNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}
function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`)
  return value
}
function runId(meta) {
  return [meta.candidateId, meta.scenarioId, meta.seed, meta.difficulty,
    meta.mode, meta.driverCar, meta.tunedCar ?? meta.driverCar,
    meta.focusRole ?? 'player', meta.policyKind ?? 'driving',
    meta.opponentCar ?? 'none', meta.duelOpponentSpeedLimit ?? 'default'].join(':')
}

/** Trace overtake time and attempts separately from lap-line performance. */
function passingMetrics(samples, vehicleId) {
  const trace = samples.filter(sample => sample.vehicleId === vehicleId)
  let passingSeconds = 0
  let attempts = 0
  for (let i = 0; i < trace.length; i++) {
    const sample = trace[i]
    const previous = trace[i - 1]
    if (!sample) continue
    if (sample.phase === 'passing' && previous?.phase !== 'passing') attempts++
    if (previous?.phase === 'passing') {
      const delta = sample.time - previous.time
      if (!validNumber(delta) || delta < 0 || delta > 1)
        throw new Error('Invalid ordered passing telemetry')
      passingSeconds += delta
    }
  }
  return { passing_seconds: Number(passingSeconds.toFixed(3)), pass_attempts: attempts }
}

/**
 * Project a genuine lane simulation into bounded, analysis-friendly rows.
 * Invalid input MUST surface as an error; never silently omit bad samples.
 */
export function projectTrial(run, meta, { telemetry = false } = {}) {
  requiredString(meta.candidateId, 'candidateId')
  requiredString(meta.scenarioId, 'scenarioId')
  requiredString(meta.driverCar, 'driverCar')
  requiredString(meta.trackFingerprint, 'trackFingerprint')
  if (!Number.isInteger(meta.seed) || meta.seed < 0 ||
    !validNumber(meta.startRatio) || !validNumber(run.simulatedSeconds))
    throw new Error('Invalid trial seed, start ratio or duration')
  const id = runId(meta)
  const base = {
    schema_version: DIAGNOSTIC_SCHEMA_VERSION,
    trial_id: id,
    candidate_id: meta.candidateId,
    scenario_id: meta.scenarioId,
    track_fingerprint: meta.trackFingerprint,
    driver_car: meta.driverCar,
    tuned_car: meta.tunedCar ?? meta.driverCar,
    policy_kind: meta.policyKind ?? 'driving',
    duel_opponent_car: meta.opponentCar ?? null,
    duel_opponent_speed_limit: meta.duelOpponentSpeedLimit ?? null,
    focus_role: meta.focusRole ?? 'player',
    grid_positions: meta.gridPositions ?? null,
    difficulty: meta.difficulty,
    mode: meta.mode,
    seed: meta.seed,
    start_ratio: meta.startRatio,
    reversed: run.reversed,
    laps_requested: run.laps,
    physics_revision: meta.physicsRevision ?? 'unknown',
  }
  const rows = run.vehicles.map(vehicle => {
    if (vehicle.finishedAt !== null && !validNumber(vehicle.finishedAt))
      throw new Error(`Invalid finish time for ${vehicle.vehicleId}`)
    if (!Number.isInteger(vehicle.recoveries) || vehicle.recoveries < 0 ||
      !validNumber(vehicle.offRoadSeconds) || !validNumber(vehicle.maxLaneError))
      throw new Error(`Invalid vehicle metrics for ${vehicle.vehicleId}`)
    return {
      ...base, vehicle_id: vehicle.vehicleId, car_type: vehicle.car,
      finished_seconds: vehicle.finishedAt,
      laps_completed: vehicle.laps, recoveries: vehicle.recoveries,
      offroad_seconds: vehicle.offRoadSeconds, max_lane_error: vehicle.maxLaneError,
      stopped_reason: run.stoppedReason,
      ...passingMetrics(run.samples, vehicle.vehicleId),
    }
  })
  const events = run.issues.map(issue => {
    const trace = issue.code === 'recovery'
      ? run.samples.filter(sample => sample.vehicleId === issue.vehicleId && sample.time < issue.time)
      : []
    const before = trace.at(-1)
    const previous = trace.at(-2)
    const elapsed = before && previous ? before.time - previous.time : 0
    const crossedRecovery = before && previous && run.issues.some(other =>
      other.code === 'recovery' && other.vehicleId === issue.vehicleId &&
      other.time > previous.time && other.time <= before.time)
    return {
      ...base,
      vehicle_id: issue.vehicleId, event_time: issue.time, code: issue.code,
      severity: issue.severity, path_index: issue.pathIndex,
      section_id: issue.sectionId, detail: issue.detail,
      ...(issue.code === 'recovery' ? {
        recovery_reason: issue.detail.match(/^Automatic (.+) recovery$/)?.[1] ?? 'unknown',
        before_time: before?.time ?? null, before_speed: before?.speed ?? null,
        before_acceleration: elapsed > 0 && !crossedRecovery ? (before.speed - previous.speed) / elapsed : null,
        before_angle: before?.angle ?? null, before_yaw_rate: before?.yawRate ?? null,
        before_steering: before?.steering ?? null, before_braking: before?.braking ?? null,
        before_road_distance: before?.roadDistance ?? null,
        before_offroad_seconds: before?.offRoadSeconds ?? null,
      } : {}),
    }
  })
  const samples = telemetry ? run.samples.map(sample => ({
    ...base, vehicle_id: sample.vehicleId, car_type: sample.car,
    time: sample.time, path_index: sample.pathIndex,
    section_id: sample.sectionId, speed: sample.speed,
    angle: sample.angle ?? null, yaw_rate: sample.yawRate ?? null,
    steering: sample.steering ?? null, slip: sample.slip ?? null,
    braking: sample.braking ?? null, road_distance: sample.roadDistance ?? null,
    offroad_seconds: sample.offRoadSeconds ?? null,
    lane: sample.lane, target_lane: sample.targetLane,
    on_road: sample.onRoad, grounded: sample.grounded,
    ai_phase: sample.phase,
  })) : []
  return { rows, events, samples }
}

export function jsonLines(rows) {
  return rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
}
