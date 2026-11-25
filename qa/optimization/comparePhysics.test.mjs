import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const script = new URL('./comparePhysics.mjs', import.meta.url)
function fixture({ beforeSeconds = 40, afterSeconds = 40, afterRecoveries = 0, event = null, samplesChanged = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'physics-compare-'))
  const beforeDir = join(root, 'before')
  const afterDir = join(root, 'after')
  mkdirSync(beforeDir); mkdirSync(afterDir)
  const task = { car: 'blue', scenarioId: 'short-track', seed: 7, difficulty: 'hard', mode: 'solo' }
  const row = (seconds, recoveries, revision) => ({ vehicle_id: 'blue-1', car_type: 'blue',
    finished_seconds: seconds, recoveries, offroad_seconds: 0, max_lane_error: 0,
    laps_completed: 2, passing_seconds: 0, pass_attempts: 0, track_fingerprint: 'track', seed: 7,
    mode: 'solo', difficulty: 'hard', start_ratio: 0, reversed: false, laps_requested: 2,
    physics_revision: revision, scenario_id: 'short-track', driver_car: 'blue', tuned_car: 'blue',
    grid_positions: null, focus_role: 'player', policy_kind: 'driving', duel_opponent_car: null,
    duel_opponent_speed_limit: null })
  const rec = (seconds, recoveries, revision) => ({ focusVehicleId: 'blue-1', driverVehicleId: 'blue-1',
    secondsSimulated: 40, rows: [row(seconds, recoveries, revision)], events: event && revision === 'new' ? [event] : [],
    samples: [{ vehicle_id: 'blue-1', car_type: 'blue', time: 0, path_index: 0, section_id: null,
      speed: samplesChanged && revision === 'new' ? 1 : 0, lane: 0, target_lane: 0,
      on_road: true, grounded: true, ai_phase: 'follow' }] })
  const beforePath = join(beforeDir, 'summary.json')
  const afterPath = join(afterDir, 'summary.json')
  writeFileSync(beforePath, JSON.stringify({ physicsRevision: 'old', scenarios: ['short-track'] }))
  writeFileSync(afterPath, JSON.stringify({ physicsRevision: 'new', scenarios: ['short-track'] }))
  writeFileSync(join(beforeDir, 'baseline-results.json'), JSON.stringify([{ task, result: rec(beforeSeconds, 0, 'old') }]))
  writeFileSync(join(afterDir, 'baseline-results.json'), JSON.stringify([{ task, result: rec(afterSeconds, afterRecoveries, 'new') }]))
  return { root, beforePath, afterPath, outputPath: join(afterDir, 'physics-comparison.json') }
}
function run(f, flags = []) {
  return spawnSync(process.execPath, [script.pathname, f.beforePath, f.afterPath, ...flags], { encoding: 'utf8' })
}

test('clean physics comparison passes with visible pace delta and no classification flag', () => {
  const f = fixture({ afterSeconds: 40.2 })
  try {
    const result = run(f)
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(readFileSync(f.outputPath, 'utf8'))
    assert.equal(report.acceptance.eligible, true)
    assert.equal(report.comparisons[0].after, 40.2)
    assert.ok(result.stdout.includes('FLEET_ACCEPTANCE'))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('physics lap-time loss is a proportional review warning, not a gate failure', () => {
  const f = fixture({ afterSeconds: 41.5 })
  try {
    const result = run(f)
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(readFileSync(f.outputPath, 'utf8'))
    assert.equal(report.comparisons[0].requiresReview, true)
    assert.equal(report.acceptance.eligible, true)
    assert.equal(report.acceptance.decision, 'accept-with-warnings')
    assert.equal(report.acceptance.timingWarnings, 1)
    assert.ok(result.stderr.includes('TIMING_REVIEW_WARNING'))
    assert.equal(report.policy.timingWarning.threshold, 'max(1 second, 2% of baseline finish time)')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('145 second baseline uses the 2 percent threshold for timing review', () => {
  const f = fixture({ beforeSeconds: 145, afterSeconds: 148 })
  try {
    const result = run(f)
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(readFileSync(f.outputPath, 'utf8'))
    assert.equal(report.comparisons[0].requiresReview, true)
    assert.equal(report.comparisons[0].gainSeconds, -3)
    assert.equal(report.acceptance.decision, 'accept-with-warnings')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('incomplete or non-finite candidate data fails closed', () => {
  const f = fixture()
  try {
    const path = join(f.root, 'after', 'baseline-results.json')
    const entries = JSON.parse(readFileSync(path, 'utf8'))
    delete entries[0].result.rows[0].offroad_seconds
    writeFileSync(path, JSON.stringify(entries))
    const result = run(f)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Invalid or duplicate candidate .*physics row/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('recovery regression remains a hard CLI failure', () => {
  const f = fixture({ afterRecoveries: 1, event: { vehicle_id: 'blue-1', severity: 'error', code: 'recovery' } })
  try {
    const result = run(f)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.equal(JSON.parse(readFileSync(f.outputPath, 'utf8')).acceptance.decision, 'reject')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('lost finish remains a hard CLI failure', () => {
  const f = fixture({ afterSeconds: null })
  try {
    const result = run(f)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    const report = JSON.parse(readFileSync(f.outputPath, 'utf8'))
    assert.equal(report.acceptance.decision, 'reject')
    assert.ok(report.comparisons[0].reasons.includes('candidate did not finish'))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('unrelated simulation errors remain hard CLI failures', () => {
  const f = fixture({ event: { vehicle_id: 'blue-1', severity: 'error', code: 'invalid-state' } })
  try {
    const result = run(f)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    const report = JSON.parse(readFileSync(f.outputPath, 'utf8'))
    assert.equal(report.acceptance.decision, 'reject')
    assert.ok(report.comparisons[0].reasons.includes('simulation error event'))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('explicit behavior-preserving mode still rejects changed exact output', () => {
  const f = fixture({ samplesChanged: true })
  try {
    const result = run(f, ['--behavior-preserving'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /changed recorded output/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
