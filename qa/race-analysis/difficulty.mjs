const round = n => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null
const roundDurations = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, round(value)]))

/** Compare time-weighted samples in fixed road-index bins, not clock time. */
export function compareDifficultyTraces(normal, hard, { binSize = 50, maxSampleGap = 0.5 } = {}) {
  if (!Number.isInteger(binSize) || binSize < 1) throw new Error('Invalid binSize')
  if (!(maxSampleGap > 0)) throw new Error('Invalid maxSampleGap')
  function aggregate(run) {
    const id = run.focusVehicleId
    const row = run.rows.find(value => value.vehicle_id === id)
    if (!row || !Number.isFinite(row.finished_seconds)) throw new Error('Comparison requires a finished focus vehicle')
    const samples = run.samples.filter(sample => sample.vehicle_id === id)
    if (samples.length < 2) throw new Error('Comparison requires sampled telemetry')
    const recoveries = run.events.filter(event => event.vehicle_id === id && event.code === 'recovery')
    const bins = new Map()
    const excluded = { recoveryIntervals: 0, gapIntervals: 0, seconds: 0 }
    let priorBin = null
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1]
      if (!Number.isFinite(a.time) || !Number.isFinite(b.time) || b.time < a.time) throw new Error('Invalid telemetry timestamps')
      const dt = Math.min(b.time, row.finished_seconds) - a.time
      if (dt <= 0) continue
      if (!Number.isFinite(a.path_index) || !Number.isFinite(a.speed)) throw new Error('Invalid telemetry sample')
      const recovered = recoveries.some(event => event.event_time > a.time && event.event_time <= b.time)
      if (recovered || dt > maxSampleGap) {
        excluded[recovered ? 'recoveryIntervals' : 'gapIntervals']++
        excluded.seconds += dt
        priorBin = null
        continue
      }
      const key = Math.floor(a.path_index / binSize) * binSize
      const bin = bins.get(key) ?? { seconds: 0, speed: 0, brakingSeconds: 0, brakingCoverage: 0, offRoadSeconds: 0, offRoadCoverage: 0, steeringSaturatedSeconds: 0, steeringCoverage: 0, lane: 0, laneSeconds: 0, slip: 0, slipSeconds: 0, entries: 0,
        ai: { coverage: 0, headingError: 0, headingErrorCoverage: 0, steeringDemandSaturatedSeconds: 0,
          steeringLagSeconds: 0, targetSpeed: 0, targetSpeedError: 0, speedCoverage: 0,
          cornerBrakingSeconds: 0, bend: 0, bendCoverage: 0, pursuitSamples: 0,
          pursuitCoverage: 0, controlModes: {}, cornerPhases: {} } }
      if (key !== priorBin) bin.entries++
      priorBin = key
      bin.seconds += dt
      bin.speed += a.speed * dt
      if (typeof a.braking === 'boolean') { bin.brakingCoverage += dt; if (a.braking) bin.brakingSeconds += dt }
      if (typeof a.on_road === 'boolean') { bin.offRoadCoverage += dt; if (!a.on_road) bin.offRoadSeconds += dt }
      if (Number.isFinite(a.steering)) { bin.steeringCoverage += dt; if (Math.abs(a.steering) >= 0.9) bin.steeringSaturatedSeconds += dt }
      if (Number.isFinite(a.slip)) { bin.slip += Math.abs(a.slip) * dt; bin.slipSeconds += dt }
      if (Number.isFinite(a.lane)) { bin.lane += Math.abs(a.lane) * dt; bin.laneSeconds += dt }
      const decision = a.ai_decision
      if (decision) {
        const ai = bin.ai
        ai.coverage += dt
        if (Number.isFinite(decision.heading_error_radians)) {
          ai.headingError += Math.abs(decision.heading_error_radians) * dt
          ai.headingErrorCoverage += dt
        }
        if (Number.isFinite(decision.unclamped_steering) && Math.abs(decision.unclamped_steering) >= 1)
          ai.steeringDemandSaturatedSeconds += dt
        if (Number.isFinite(decision.desired_steering) && Number.isFinite(decision.applied_steering) &&
            Math.abs(decision.desired_steering - decision.applied_steering) >= 0.2)
          ai.steeringLagSeconds += dt
        if (Number.isFinite(decision.target_speed) && Number.isFinite(decision.target_speed_error)) {
          ai.targetSpeed += decision.target_speed * dt
          ai.targetSpeedError += decision.target_speed_error * dt
          ai.speedCoverage += dt
        }
        if (Number.isFinite(decision.bend)) { ai.bend += decision.bend * dt; ai.bendCoverage += dt }
        if (Number.isFinite(decision.pursuit_samples)) {
          ai.pursuitSamples += decision.pursuit_samples * dt
          ai.pursuitCoverage += dt
        }
        if (decision.control_mode === 'corner-braking') ai.cornerBrakingSeconds += dt
        if (typeof decision.control_mode === 'string')
          ai.controlModes[decision.control_mode] = (ai.controlModes[decision.control_mode] ?? 0) + dt
        if (typeof decision.corner_phase === 'string')
          ai.cornerPhases[decision.corner_phase] = (ai.cornerPhases[decision.corner_phase] ?? 0) + dt
      }
      bins.set(key, bin)
    }
    for (const [key, bin] of bins) bins.set(key, {
      seconds: round(bin.seconds), meanSpeed: round(bin.speed / bin.seconds),
      brakingSeconds: bin.brakingCoverage ? round(bin.brakingSeconds) : null,
      offRoadSeconds: bin.offRoadCoverage ? round(bin.offRoadSeconds) : null,
      steeringSaturatedSeconds: bin.steeringCoverage ? round(bin.steeringSaturatedSeconds) : null,
      meanAbsoluteSlip: bin.slipSeconds ? round(bin.slip / bin.slipSeconds) : null, entries: bin.entries,
      meanAbsoluteLane: bin.laneSeconds ? round(bin.lane / bin.laneSeconds) : null,
      ai: bin.ai.coverage ? {
        coverageSeconds: round(bin.ai.coverage),
        meanAbsoluteHeadingErrorDegrees: bin.ai.headingErrorCoverage
          ? round(bin.ai.headingError / bin.ai.headingErrorCoverage * 180 / Math.PI) : null,
        steeringDemandSaturatedSeconds: round(bin.ai.steeringDemandSaturatedSeconds),
        steeringLagSeconds: round(bin.ai.steeringLagSeconds),
        meanTargetSpeed: bin.ai.speedCoverage ? round(bin.ai.targetSpeed / bin.ai.speedCoverage) : null,
        meanTargetSpeedError: bin.ai.speedCoverage ? round(bin.ai.targetSpeedError / bin.ai.speedCoverage) : null,
        cornerBrakingSeconds: round(bin.ai.cornerBrakingSeconds),
        meanBend: bin.ai.bendCoverage ? round(bin.ai.bend / bin.ai.bendCoverage) : null,
        meanPursuitSamples: bin.ai.pursuitCoverage ? round(bin.ai.pursuitSamples / bin.ai.pursuitCoverage) : null,
        controlModeSeconds: roundDurations(bin.ai.controlModes),
        cornerPhaseSeconds: roundDurations(bin.ai.cornerPhases),
      } : null,
    })
    excluded.seconds = round(excluded.seconds)
    return { row, bins, excluded }
  }
  const a = aggregate(normal), b = aggregate(hard)
  const sections = [...a.bins.keys()].filter(key => b.bins.has(key)).map(key => ({
    pathIndexFrom: key, pathIndexTo: key + binSize - 1,
    normal: a.bins.get(key), hard: b.bins.get(key),
    secondsDelta: round(b.bins.get(key).seconds - a.bins.get(key).seconds),
    comparableEntries: a.bins.get(key).entries === b.bins.get(key).entries,
  })).sort((x, y) => Math.abs(y.secondsDelta) - Math.abs(x.secondsDelta))
  return {
    finishDelta: round(b.row.finished_seconds - a.row.finished_seconds), sections,
    unmatched: { normal: [...a.bins.keys()].filter(key => !b.bins.has(key)), hard: [...b.bins.keys()].filter(key => !a.bins.has(key)) },
    excluded: { normal: a.excluded, hard: b.excluded },
  }
}
