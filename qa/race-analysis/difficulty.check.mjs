import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareDifficultyTraces } from './difficulty.mjs'

const sample = (time, path_index, speed, braking = false) => ({ vehicle_id: 'player', time, path_index, speed, braking, steering: 0.5, lane: 0, on_road: true })
const run = (samples, events = []) => ({ rows: [{ vehicle_id: 'player', finished_seconds: samples.at(-1).time, recoveries: events.length }], focusVehicleId: 'player', samples, events })
test('compares time, pace and braking over matched road sections', () => {
  const normal = run([sample(0, 0, 100), sample(1, 0, 100), sample(2, 50, 100), sample(3, 50, 100)])
  const hard = run([sample(0, 0, 50, true), sample(1.5, 0, 50, true), sample(3, 50, 100), sample(4, 50, 100)])
  const result = compareDifficultyTraces(normal, hard, { binSize: 50, maxSampleGap: 2 })
  assert.equal(result.finishDelta, 1)
  assert.equal(result.sections[0].pathIndexFrom, 0)
  assert.equal(result.sections[0].secondsDelta, 1)
  assert.equal(result.sections[0].hard.brakingSeconds, 3)
  assert.equal(result.sections[0].hard.meanSpeed, 50)
})
test('excludes recovery discontinuities and flags missing coverage', () => {
  const recovery = [{ vehicle_id: 'player', code: 'recovery', event_time: 1.5 }]
  const normal = run([sample(0, 0, 100), sample(1, 0, 100), sample(2, 100, 90), sample(3, 100, 90)], recovery)
  const hard = run([sample(0, 0, 100), sample(1, 0, 100), sample(2, 50, 100), sample(3, 50, 100)])
  const result = compareDifficultyTraces(normal, hard, { maxSampleGap: 2 })
  assert.equal(result.excluded.normal.recoveryIntervals, 1)
  assert.ok(result.unmatched.normal.includes(100))
  assert.ok(result.unmatched.hard.includes(50))
  assert.throws(() => compareDifficultyTraces(normal, hard, { binSize: 0 }), /binSize/)
})

test('runs the matched Desert Reverse study with explicit experimental Normal settings', { timeout: 30000 }, async () => {
  const { runDifficultyComparison } = await import('./difficulty-runner.mjs')
  const result = await runDifficultyComparison(['desert-reverse', '--car', 'red', '--normal-bonus', '0.1', '--normal-reserve', '0.2'])
  assert.equal(result.car, 'red')
  assert.equal(result.normalOverrides.normalCornerTargetBonus, 0.1)
  assert.ok(Number.isFinite(result.finishDelta))
  assert.equal(result.normal.recoveries, 0)
  assert.equal(result.hard.recoveries, 0)
  const section = result.sections.find(value => value.pathIndexFrom === 250)
  assert.ok(section)
  assert.equal(typeof section.comparableEntries, 'boolean')
  assert.ok(Number.isFinite(section.hard.meanSpeed))
})
