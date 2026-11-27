import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

test('simulation preserves authored checkpoints and emits detailed telemetry', { timeout: 30000 }, () => {
  const output = execFileSync(process.execPath, [resolve('qa/race-analysis/cli.mjs'), 'simulate',
    resolve('tests/fixtures/kidsRoomAi.trackforge.json'), '--car', 'red', '--mode', 'solo',
    '--difficulty', 'normal', '--laps', '1', '--seconds', '145', '--level', '2'], { encoding: 'utf8' })
  const line = output.split('\n').find(item => item.startsWith('TRACKFORGE_AI_DIAGNOSTIC '))
  assert.ok(line)
  const report = JSON.parse(line.slice('TRACKFORGE_AI_DIAGNOSTIC '.length))
  const diagnostics = report.rows[0].vehicles[0].diagnostics
  assert.equal(diagnostics.level, 2)
  assert.ok(diagnostics.sectors.length > 1, 'authored timing gates must be present')
  assert.ok(diagnostics.turns.length > 0, 'sampled yaw should expose turns')
})
