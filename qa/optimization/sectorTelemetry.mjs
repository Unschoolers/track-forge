// Summarize applied vehicle behavior, not unobservable pedal requests.
const DT = 1 / 60
export function sectorCollector() {
  let start = 0
  let ticks = 0
  let speed = 0
  let brakeTicks = 0
  let grassTicks = 0
  let distance = 0
  let peak = 0
  const sectors = []
  return {
    sectors,
    observe(before, after, gates) {
      if (before.finishedAt !== null) return
      if (![after.speed, before.x, before.y, after.x, after.y].every(Number.isFinite))
        throw new Error('Non-finite sector telemetry')
      ticks++
      speed += after.speed
      peak = Math.max(peak, after.speed)
      brakeTicks += Number(after.braking)
      grassTicks += Number(after.currentSurface === 'grass')
      distance += Math.hypot(after.x - before.x, after.y - before.y)
      for (const gate of gates) {
        if (!Number.isFinite(gate.time) || gate.time < start)
          throw new Error('Unordered gate telemetry')
        sectors.push({ lap: gate.lap, gate: gate.gate, time: gate.time,
          seconds: gate.time - start, averageSpeed: ticks ? speed / ticks : null,
          peakSpeed: ticks ? peak : null, brakeSeconds: brakeTicks * DT,
          grassSeconds: grassTicks * DT, distance })
        start = gate.time
        ticks = speed = brakeTicks = grassTicks = distance = peak = 0
      }
    },
  }
}
