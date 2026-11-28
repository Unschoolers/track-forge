import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnoseTimeline } from './diagnostics.mjs'

const samples = [
  { time: 1, speed: 20, angle: 0, yawRate: 0.3, steering: 0.5, pathIndex: 10, onRoad: true },
  { time: 1.5, speed: 30, angle: 0.2, yawRate: 0.4, steering: 0.8, pathIndex: 20, onRoad: true },
  { time: 2, speed: 25, angle: 0.5, yawRate: 0.5, steering: 1, pathIndex: 30, onRoad: false },
  { time: 2.5, speed: 10, angle: 0, yawRate: 0, steering: 0, pathIndex: 15, cut: true },
]
const events = [{ time: 2.5, type: 'vehicle-recovered', reason: 'off-road', pathIndex: 30 }]
const gates = [{ lap: 0, gate: 1, time: 3 }, { lap: 0, gate: 2, time: 5 },
  { lap: 1, gate: 1, time: 8 }, { lap: 1, gate: 2, time: 11 }]

test('levels preserve exact recovery reason, preceding telemetry, and sector timing', () => {
  const level1 = diagnoseTimeline({ samples, events, gates }, 1)
  assert.equal(level1.recoveries[0].time, 2.5)
  assert.equal(level1.recoveries[0].reason, 'off-road')
  assert.equal(level1.recoveries[0].before.speed, 25)
  assert.equal(level1.recoveries[0].before.acceleration, -10)
  assert.equal(level1.recoveries[0].before.angle, 0.5)
  assert.equal(level1.sectors[3].seconds, 3)
  assert.equal(level1.sectors[3].previousLapDelta, 1)
  assert.equal(level1.turns, undefined)
  const level2 = diagnoseTimeline({ samples, events, gates }, 2)
  assert.ok(level2.turns.length > 0)
  assert.equal(level2.turns[0].entryHeading, 0)
  assert.equal(level2.turns[0].peakSteering, 1)
  assert.equal(level2.turns[0].minimumAcceleration, -10)
  assert.equal(level2.recoveries[0].approach.length, 3)
  const level3 = diagnoseTimeline({ samples, events, gates }, 3)
  assert.equal(level3.samples.length, 4)
  assert.equal(level3.samples[3].acceleration, null)
})

test('missing measurements remain unknown and invalid levels fail', () => {
  const result = diagnoseTimeline({ samples: [{ time: 0, speed: 3 }], events: [{ time: 0, type: 'vehicle-recovered' }], gates: [] }, 2)
  assert.equal(result.recoveries[0].before, null)
  assert.equal(result.recoveries[0].reason, 'unknown')
  assert.deepEqual(result.turns, [])
  assert.throws(() => diagnoseTimeline({ samples: [], events: [], gates: [] }, 4), /level/)
})
