import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateCandidates } from './candidates.mjs'
import { assessCandidate, evaluatePair, trialKey, compareScores, PHYSICS_ACCEPTANCE } from './score.mjs'

test('candidate enumeration stays bounded and deterministic', () => {
  const base = { hardCornerTargetBonus: 0.04, hardSteerGain: 2.22,
    hardLookAheadSamples: 10, hardEdgeAvoidanceScale: 0.4, hardCornerReserve: 0 }
  const a = generateCandidates('blue', base, 14)
  assert.deepEqual(a, generateCandidates('blue', base, 14))
  assert.equal(a.length, 14)
  assert.ok(a.every(x => x.car === 'blue'))
  assert.throws(() => generateCandidates('blue', base, 0))
  assert.throws(() => generateCandidates('unknown', base, 4))
})
test('pair comparisons reject recovery, roster, and incomparable metadata', () => {
  const row = {
    vehicle_id: 'v0', car_type: 'blue', finished_seconds: 35,
    recoveries: 0, track_fingerprint: 'same', seed: 1, mode: 'solo',
    difficulty: 'hard', start_ratio: 0.5, reversed: false,
    laps_requested: 2, physics_revision: 'sha', scenario_id: 'desert',
  }
  const wrap = (time, overrides = {}) => ({ rows: [{ ...row, finished_seconds: time, ...overrides }],
    driverVehicleId: 'v0', events: [] })
  assert.equal(evaluatePair(wrap(35), wrap(33)).eligible, true)
  assert.equal(evaluatePair(wrap(35), wrap(32, { recoveries: 1 })).eligible, false)
  assert.equal(evaluatePair(wrap(35), wrap(37)).eligible, false)
  assert.throws(() => evaluatePair(wrap(35), wrap(33, { physics_revision: 'other' })), /mismatch/)
  assert.equal(evaluatePair(wrap(35), wrap(33, { physics_revision: 'other' }), { allowPhysicsRevisionChange: true }).eligible, true)
  assert.throws(() => evaluatePair(wrap(35), wrap(33, { physics_revision: 'other', track_fingerprint: 'wrong' }), { allowPhysicsRevisionChange: true }), /mismatch/)
  assert.equal(evaluatePair(wrap(35), wrap(33, { recoveries: 1 }), { requireZeroRecoveries: false }).eligible, false)
  assert.equal(assessCandidate([[wrap(35), wrap(33)]]).eligible, true)
  assert.equal(assessCandidate([[wrap(35), wrap(34.9)]], { minGain: 0.01 }).eligible, false)
  assert.equal(trialKey({ car: 'blue', scenarioId: 'desert', seed: 1,
    difficulty: 'hard', mode: 'solo' }), 'blue|blue|player|driving|none|default|desert|1|hard|solo')
})

test('traffic comparison measures the tuned rival, not the player-slot car', () => {
  const base = {
    vehicle_id: 'green-rival', car_type: 'green',
    finished_seconds: 75, recoveries: 0,
    track_fingerprint: 'same', seed: 1, mode: 'traffic',
    difficulty: 'hard', start_ratio: 0.2, reversed: false,
    laps_requested: 2, physics_revision: 'sha', scenario_id: 'kids',
    driver_car: 'red', tuned_car: 'green', grid_positions: null,
  }
  const player = { ...base, vehicle_id: 'red-player', car_type: 'red',
    finished_seconds: 99 }
  const record = (greenTime, recoveries = 0) => ({
    rows: [player, { ...base, finished_seconds: greenTime, recoveries }],
    focusVehicleId: 'green-rival',
    driverVehicleId: 'red-player', events: [],
  })
  const pass = evaluatePair(record(75), record(73))
  assert.equal(pass.car, 'green')
  assert.ok(pass.improvement > 0.02)
  assert.equal(evaluatePair(record(75), record(72, 1)).eligible, false)
  assert.notEqual(
    trialKey({ car: 'green', playerCar: 'red', scenarioId: 'kids',
      seed: 1, difficulty: 'hard', mode: 'traffic' }),
    trialKey({ car: 'green', playerCar: 'green', scenarioId: 'kids',
      seed: 1, difficulty: 'hard', mode: 'traffic' }),
  )
})

test('Hard mirror role differs from the AI-controlled player, even for the same car', () => {
  const task = { car: 'yellow', playerCar: 'yellow', scenarioId: 'kids-room',
    seed: 1, difficulty: 'hard', mode: 'traffic' }
  assert.notEqual(trialKey({ ...task, focusRole: 'player' }),
    trialKey({ ...task, focusRole: 'rival' }))
})

test('duel experiments have independent dimensions from solo or full traffic', () => {
  const common = {
    car: 'red', playerCar: 'red', scenarioId: 'kids-room',
    seed: 4331, difficulty: 'hard', policyKind: 'passing',
  }
  assert.notEqual(trialKey({ ...common, mode: 'duel', opponentCar: 'yellow' }),
    trialKey({ ...common, mode: 'solo' }))
  assert.notEqual(trialKey({ ...common, mode: 'duel', opponentCar: 'yellow' }),
    trialKey({ ...common, mode: 'duel', opponentCar: 'green' }))
  assert.notEqual(trialKey({ ...common, mode: 'duel', opponentCar: 'yellow' }),
    trialKey({ ...common, mode: 'traffic' }))
})

test('recovery-first acceptance preserves debt visibility and rejects new errors', () => {
  const row = { vehicle_id: 'v0', car_type: 'yellow', finished_seconds: 40,
    recoveries: 2, track_fingerprint: 'same', physics_revision: 'old' }
  const run = (seconds, recoveries, revision = 'old', extra = []) => ({
    rows: [{ ...row, finished_seconds: seconds, recoveries, physics_revision: revision }],
    driverVehicleId: 'v0',
    events: [...Array.from({ length: recoveries }, () => ({
      code: 'recovery', severity: 'error', vehicle_id: 'v0',
    })), ...extra],
  })
  const before = run(40, 2)
  const tolerated = evaluatePair(before, run(40.7, 2, 'new'), PHYSICS_ACCEPTANCE)
  assert.equal(tolerated.eligible, true)
  assert.equal(tolerated.recoveriesAfter, 2)
  assert.equal(evaluatePair(before, run(39, 3, 'new'), PHYSICS_ACCEPTANCE).eligible, false)
  assert.equal(evaluatePair(before, run(40.9, 2, 'new'), PHYSICS_ACCEPTANCE).eligible, false)
  assert.equal(evaluatePair(before, run(39, 2, 'new', [{ code: 'invalid-state', severity: 'error', vehicle_id: 'v0' }]), PHYSICS_ACCEPTANCE).eligible, false)
  const safer = assessCandidate([[before, run(40.6, 1)]])
  const faster = assessCandidate([[before, run(39, 2)]])
  assert.equal(safer.eligible, true)
  assert.equal(faster.eligible, true)
  assert.ok(compareScores(safer, faster) < 0)
  assert.equal(assessCandidate([[before, run(40.7, 2, 'new')]], PHYSICS_ACCEPTANCE).eligible, true)
  const opponent = { ...row, vehicle_id: 'v1', car_type: 'red', recoveries: 0 }
  const oldTraffic = { ...before, rows: [...before.rows, opponent] }
  const newTraffic = { ...run(39, 0, 'new'), rows: [...run(39, 0, 'new').rows, { ...opponent, recoveries: 1 }] }
  assert.equal(evaluatePair(oldTraffic, newTraffic, PHYSICS_ACCEPTANCE).eligible, false)
})
