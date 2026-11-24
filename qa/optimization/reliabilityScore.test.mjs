import assert from 'node:assert/strict'
import { test } from 'node:test'
import { noNewDebt, crossTrackRegressions, compareResults } from './reliabilityScore.mjs'

const record = (red, green, recoveries = 0) => ({
  driverVehicleId: 'player', focusVehicleId: 'player',
  rows: [
    { vehicle_id: 'player', car_type: 'red', finished_seconds: red, recoveries: 0 },
    { vehicle_id: 'ai-1', car_type: 'green', finished_seconds: green, recoveries },
  ],
  events: Array.from({ length: recoveries }, () => ({ vehicle_id: 'ai-1', code: 'recovery', severity: 'error' })),
})
test('cross-track guard detects a slower rival even if the focus car improves', () => {
  const failures = crossTrackRegressions([record(40, 40)], [record(39, 41.01)])
  assert.equal(failures.length, 1)
  assert.equal(failures[0].vehicleId, 'ai-1')
  assert.equal(failures[0].requiresReview, true)
})
test('new rival recoveries are never accepted in a cross-track candidate', () => {
  assert.ok(crossTrackRegressions([record(40, 40)], [record(39, 39, 1)]).some(x => x.hardFailure))
  assert.equal(noNewDebt([record(40, 40)], [record(39, 39, 1)]), false)
})
test('Hairpin baseline DNF may be repaired, not moved to another driver', () => {
  assert.equal(noNewDebt([record(40, null, 1)], [record(39, 40)]), true)
  assert.equal(noNewDebt([record(40, null, 1)], [record(null, 40)]), false)
})
test('reliability wins before aggregate time', () => {
  const a = { hairpin: { errors: 0, dnf: 0, recoveries: 0, seconds: 200, offroad: 0 }, crossTrack: { errors: 0, dnf: 0, recoveries: 0, seconds: 400 } }
  const b = { ...a, hairpin: { ...a.hairpin, recoveries: 1, seconds: 180 } }
  assert.ok(compareResults(a, b) < 0)
})
