/** Sampled observations, not a reconstruction of the exact cause of an incident. */
const finite = Number.isFinite
const round = value => finite(value) ? Math.round(value * 1000) / 1000 : null

export function diagnoseTimeline({ samples, events, gates }, level = 1) {
  if (![1, 2, 3].includes(level)) throw new Error('Diagnostic level must be 1, 2 or 3')
  const timeline = samples.map((sample, i) => {
    const previous = samples[i - 1]
    const dt = previous ? sample.time - previous.time : 0
    return { ...sample, acceleration: dt > 0 && !sample.cut && finite(sample.speed) && finite(previous.speed)
      ? round((sample.speed - previous.speed) / dt) : null }
  })
  const recoveries = events.filter(event => event.type === 'vehicle-recovered').map(event => {
    const preceding = timeline.filter(sample => sample.time < event.time).at(-1) ?? null
    const before = event.before ? {
      ...event.before,
      acceleration: preceding && event.before.time > preceding.time && !event.before.cut
        ? round((event.before.speed - preceding.speed) / (event.before.time - preceding.time)) : null,
    } : preceding
    return {
      time: round(event.time), reason: event.reason ?? 'unknown', pathIndex: event.pathIndex ?? null,
      before,
      ...(level >= 2 ? { approach: timeline.filter(sample => sample.time < event.time && sample.time >= event.time - 2) } : {}),
    }
  })
  let previousTime = 0
  const priorLap = new Map()
  const sectors = gates.map(gate => {
    const seconds = round(gate.time - previousTime)
    previousTime = gate.time
    const prior = priorLap.get(gate.gate)
    const item = { ...gate, seconds, previousLapDelta: prior?.lap === gate.lap - 1 ? round(seconds - prior.seconds) : null }
    priorLap.set(gate.gate, { lap: gate.lap, seconds })
    return item
  })
  const result = { level, recoveries, sectors }
  {
    const turns = []
    let active = []
    const flush = () => {
      if (active.length >= 2 && active.at(-1).time - active[0].time >= 0.25) turns.push({
        from: round(active[0].time), to: round(active.at(-1).time),
        startPathIndex: active[0].pathIndex ?? null, endPathIndex: active.at(-1).pathIndex ?? null,
        entrySpeed: round(active[0].speed), minimumSpeed: round(Math.min(...active.map(s => s.speed).filter(finite))),
        exitSpeed: round(active.at(-1).speed), peakYawRate: round(Math.max(...active.map(s => Math.abs(s.yawRate)))),
        entryHeading: round(active[0].angle), exitHeading: round(active.at(-1).angle),
        peakSteering: active.some(s => finite(s.steering))
          ? round(Math.max(...active.filter(s => finite(s.steering)).map(s => Math.abs(s.steering)))) : null,
        minimumAcceleration: active.some(s => finite(s.acceleration))
          ? round(Math.min(...active.filter(s => finite(s.acceleration)).map(s => s.acceleration))) : null,
        maximumSlip: active.some(s => finite(s.slip))
          ? round(Math.max(...active.filter(s => finite(s.slip)).map(s => Math.abs(s.slip)))) : null,
      })
      active = []
    }
    for (const sample of timeline) {
      if (sample.cut || !finite(sample.yawRate) || Math.abs(sample.yawRate) < 0.25) flush()
      else active.push(sample)
    }
    flush()
    result.turnSummary = { detected: turns.length, slowestMinimumSpeed: turns.length ? Math.min(...turns.map(turn => turn.minimumSpeed)) : null }
    if (level >= 2) result.turns = turns
  }
  if (level >= 3) result.samples = timeline
  return result
}
