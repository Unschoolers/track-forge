const round = n => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null

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
      const bin = bins.get(key) ?? { seconds: 0, speed: 0, brakingSeconds: 0, brakingCoverage: 0, offRoadSeconds: 0, offRoadCoverage: 0, steeringSaturatedSeconds: 0, steeringCoverage: 0, lane: 0, laneSeconds: 0, slip: 0, slipSeconds: 0, entries: 0 }
      if (key !== priorBin) bin.entries++
      priorBin = key
      bin.seconds += dt
      bin.speed += a.speed * dt
      if (typeof a.braking === 'boolean') { bin.brakingCoverage += dt; if (a.braking) bin.brakingSeconds += dt }
      if (typeof a.on_road === 'boolean') { bin.offRoadCoverage += dt; if (!a.on_road) bin.offRoadSeconds += dt }
      if (Number.isFinite(a.steering)) { bin.steeringCoverage += dt; if (Math.abs(a.steering) >= 0.9) bin.steeringSaturatedSeconds += dt }
      if (Number.isFinite(a.slip)) { bin.slip += Math.abs(a.slip) * dt; bin.slipSeconds += dt }
      if (Number.isFinite(a.lane)) { bin.lane += Math.abs(a.lane) * dt; bin.laneSeconds += dt }
      bins.set(key, bin)
    }
    for (const [key, bin] of bins) bins.set(key, {
      seconds: round(bin.seconds), meanSpeed: round(bin.speed / bin.seconds),
      brakingSeconds: bin.brakingCoverage ? round(bin.brakingSeconds) : null,
      offRoadSeconds: bin.offRoadCoverage ? round(bin.offRoadSeconds) : null,
      steeringSaturatedSeconds: bin.steeringCoverage ? round(bin.steeringSaturatedSeconds) : null,
      meanAbsoluteSlip: bin.slipSeconds ? round(bin.slip / bin.slipSeconds) : null, entries: bin.entries,
      meanAbsoluteLane: bin.laneSeconds ? round(bin.lane / bin.laneSeconds) : null,
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
