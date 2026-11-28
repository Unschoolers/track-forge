import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DIAGNOSTIC_SCHEMA_VERSION, jsonLines, projectTrial } from './records.mjs'

const meta = {
  candidateId: 'base', scenarioId: 'desert-reverse', driverCar: 'green',
  trackFingerprint: 'abc123', seed: 1, startRatio: 0.5,
  difficulty: 'hard', mode: 'solo', physicsRevision: 'test-sha',
}
const run = {
  reversed: true, laps: 2, simulatedSeconds: 30, stoppedReason: 'finished',
  vehicles: [{
    vehicleId: 'green-1', car: 'green', finishedAt: 29, laps: 2,
    recoveries: 0, offRoadSeconds: 0.1, maxLaneError: 3,
  }],
  issues: [{
    vehicleId: 'green-1', time: 13, code: 'off-road', severity: 'warning',
    pathIndex: 123, sectionId: 'section', detail: 'slight grass',
  }],
  samples: [{
    vehicleId: 'green-1', car: 'green', time: 12, pathIndex: 123,
    sectionId: 'section', speed: 80, lane: 4, targetLane: 3,
    onRoad: true, grounded: true, phase: 'follow',
  }],
}
test('one row per car with stable comparison dimensions', () => {
  const result = projectTrial(run, meta)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].schema_version, DIAGNOSTIC_SCHEMA_VERSION)
  assert.equal(result.rows[0].finished_seconds, 29)
  assert.equal(result.events.length, 1)
  assert.deepEqual(result.samples, [])
  assert.ok(result.rows[0].trial_id.includes('desert-reverse'))
  assert.equal(JSON.parse(jsonLines(result.rows)).vehicle_id, 'green-1')
})
test('optional telemetry remains separate from summary and events', () => {
  const decision = {
    vehicleId: 'green-1', time: 12, pathIndex: 123, targetIndex: 140,
    lookAheadSamples: 13, pursuitSamples: 17, targetDistance: 110, headingErrorRadians: 0.3,
    unclampedSteering: 1.2, desiredSteering: 1, appliedSteering: 0.8,
    pursuitLane: 4, bend: 0.1, cornerBend: 0.14, cornerPhase: 'turn',
    cornerPursuitScale: 0.9, edgeRisk: 0.2, targetSpeed: 105,
    targetSpeedError: 12, controlMode: 'corner-braking', throttle: 0,
    brakePressure: 0.7, braking: true, aheadDistance: null, aheadTtc: null,
  }
  const output = projectTrial({ ...run, aiDecisions: [decision] }, meta, { telemetry: true })
  assert.equal(output.samples[0].speed, 80)
  assert.deepEqual(output.samples[0].ai_decision, {
    path_index: 123, target_index: 140, look_ahead_samples: 13, pursuit_samples: 17,
    target_distance: 110, heading_error_radians: 0.3,
    unclamped_steering: 1.2, desired_steering: 1, applied_steering: 0.8,
    pursuit_lane: 4, bend: 0.1, corner_bend: 0.14, corner_phase: 'turn',
    corner_pursuit_scale: 0.9, edge_risk: 0.2, target_speed: 105,
    target_speed_error: 12, control_mode: 'corner-braking', throttle: 0,
    brake_pressure: 0.7, braking: true, ahead_distance: null, ahead_ttc: null,
  })
})
test('invalid measurements fail loudly', () => {
  assert.throws(() => projectTrial({
    ...run, vehicles: [{ ...run.vehicles[0], finishedAt: Number.NaN }],
  }, meta), /Invalid finish time/)
  assert.throws(() => projectTrial(run, { ...meta, seed: -2 }), /Invalid trial/)
})

test('passing diagnostics quantify actual two-car activity separately from lap time', () => {
  const samples = [
    { ...run.samples[0], time: 0, phase: 'follow' },
    { ...run.samples[0], time: 0.1, phase: 'passing' },
    { ...run.samples[0], time: 0.2, phase: 'passing' },
    { ...run.samples[0], time: 0.3, phase: 'rejoin' },
    { ...run.samples[0], time: 0.4, phase: 'passing' },
    { ...run.samples[0], time: 0.5, phase: 'follow' },
  ]
  const row = projectTrial({ ...run, samples }, { ...meta, mode: 'duel', opponentCar: 'yellow', policyKind: 'passing' }).rows[0]
  assert.equal(row.policy_kind, 'passing')
  assert.equal(row.duel_opponent_car, 'yellow')
  assert.equal(row.pass_attempts, 2)
  assert.equal(row.passing_seconds, 0.3)
})

test('recovery events retain their cause and preceding driving context without full telemetry', () => {
  const sample = { ...run.samples[0], angle: 0.4, yawRate: 0.6, steering: 0.8, roadDistance: 94, offRoadSeconds: 0.4 }
  const result = projectTrial({ ...run, samples: [sample], issues: [{
    ...run.issues[0], code: 'recovery', detail: 'Automatic off-road recovery',
  }] }, meta)
  assert.equal(result.events[0].recovery_reason, 'off-road')
  assert.equal(result.events[0].before_speed, 80)
  assert.equal(result.events[0].before_steering, 0.8)
  assert.equal(result.events[0].before_road_distance, 94)
  assert.deepEqual(result.samples, [])
})
