import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recoveryRegression } from './recoveryPolicy.mjs'
import { evaluatePair } from './score.mjs'

test('Hard requires zero recoveries, irrespective of baseline', () => {
  assert.equal(recoveryRegression('hard', 1, 0), null)
  assert.match(recoveryRegression('hard', 0, 1), /Hard/)
  assert.match(recoveryRegression('hard', 1, 1), /Hard/)
})
test('Normal permits existing mistakes, but flags newly introduced recoveries', () => {
  assert.equal(recoveryRegression('normal', 1, 1), null)
  assert.equal(recoveryRegression('normal', 2, 1), null)
  assert.match(recoveryRegression('normal', 1, 2), /Normal/)
})
test('Easy accepts two additional recoveries; three triggers investigation', () => {
  for (const old of [0, 1, 3]) {
    assert.equal(recoveryRegression('easy', old, old), null)
    assert.equal(recoveryRegression('easy', old, old + 1), null)
    assert.equal(recoveryRegression('easy', old, old + 2), null)
    assert.match(recoveryRegression('easy', old, old + 3), /investigate/)
  }
  assert.throws(() => recoveryRegression('easy', 1, -1), /Invalid/)
})

const vehicle = {
  vehicle_id: 'v0', car_type: 'green', finished_seconds: 80,
  recoveries: 0, track_fingerprint: 'same', seed: 1, mode: 'solo',
  difficulty: 'easy', start_ratio: 0.2, reversed: false,
  laps_requested: 2, physics_revision: 'sha', scenario_id: 'kids',
  driver_car: 'green', tuned_car: 'green', focus_role: 'player',
  grid_positions: null, offroad_seconds: 1,
}
const wrap = (recoveries, events = []) => ({
  rows: [{ ...vehicle, recoveries }],
  driverVehicleId: 'v0', events,
})
test('Easy recovery events use count tolerance but other simulation errors remain blockers', () => {
  const recovery = { severity: 'error', code: 'recovery' }
  assert.equal(evaluatePair(wrap(0), wrap(2, [recovery, recovery])).eligible, true)
  assert.equal(evaluatePair(wrap(0), wrap(3, [recovery, recovery, recovery])).eligible, false)
  assert.equal(evaluatePair(wrap(0), wrap(1, [recovery, { severity: 'error', code: 'path-jump' }])).eligible, false)
  assert.equal(evaluatePair(wrap(0), wrap(1, [recovery, { severity: 'error', code: 'timeout' }])).eligible, false)
  const onHard = { ...vehicle, difficulty: 'hard' }
  const hardRun = count => ({ rows: [{ ...onHard, recoveries: count }],
    driverVehicleId: 'v0', events: count ? [recovery] : [] })
  assert.equal(evaluatePair(hardRun(0), hardRun(1)).eligible, false)
})
