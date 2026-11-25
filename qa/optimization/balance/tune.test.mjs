import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tuneBalance } from './tune.mjs'
import { DEFAULT_CARS } from '../candidates.mjs'
import { trialKey } from '../score.mjs'

test('equal search budgets select on calibration and validate frozen profiles on holdouts', async () => {
  const calls = []
  const profile = { hardCornerTargetBonus: 0.3, hardLookAheadSamples: 10,
    hardSteerGain: 2.5, hardReaction: 10, hardCornerReserve: 0.05, hardEdgeAvoidanceScale: 0.5 }
  const pool = { baselineProfiles: Object.fromEntries(DEFAULT_CARS.map(car => [car, profile])),
    async submit(task) {
      calls.push(task)
      const improved = Object.keys(task.changes).length || task.profileOverrides
      return { focusVehicleId: 'v', events: [], rows: [{ vehicle_id: 'v', car_type: task.car,
        finished_seconds: improved ? 39 : 40, recoveries: 0, offroad_seconds: 0,
        track_fingerprint: task.scenarioId, scenario_id: task.scenarioId, seed: task.seed,
        mode: task.mode, difficulty: task.difficulty, start_ratio: 0, reversed: false,
        laps_requested: 1, physics_revision: 'test', driver_car: task.playerCar,
        tuned_car: task.car, focus_role: task.focusRole, policy_kind: task.policyKind }] }
    } }
  const scenarios = Array.from({ length: 6 }, (_, i) => ({ id: `synthetic-${i}` }))
  const result = await tuneBalance({ pool, scenarios, holdoutScenarios: [{ id: 'real' }], seeds: [1], trials: 3 })
  assert.equal(result.attemptedPerCar, 3)
  const baselineCalls = calls.filter(task => task.candidateId.startsWith('balance-base-'))
  assert.equal(new Set(baselineCalls.map(trialKey)).size, baselineCalls.length)
  for (const car of DEFAULT_CARS) {
    assert.equal(result.candidates.filter(x => x.car === car).length, 3)
    assert.ok(Object.keys(result.selectedChanges[car]).length)
    assert.ok(result.perCar.find(x => x.car === car).validation.eligible)
  }
  assert.ok(result.combined.eligible)
  assert.ok(calls.filter(x => x.profileOverrides).every(x => x.scenarioId === 'real'))
  assert.ok(calls.filter(x => !x.candidateId.startsWith('balance-')).every(x =>
    x.scenarioId.startsWith('synthetic-') || result.perCar.some(p => p.selected?.id === x.candidateId)))
  assert.ok(calls.some(x => x.scenarioId === 'real' && x.mode === 'traffic' && x.focusRole === 'rival'))
  await assert.rejects(() => tuneBalance({ pool, scenarios, holdoutScenarios: [scenarios[0]], seeds: [1], trials: 3 }), /disjoint/)
})
