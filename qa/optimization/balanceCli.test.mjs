import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('balance CLI measures every car on every surface and layout with the real worker', () => {
  const out = mkdtempSync(join(tmpdir(), 'trackforge-balance-'))
  try {
    execFileSync(process.execPath, ['qa/optimization/cli.mjs', '--focus', 'balance',
      '--workers', '2', '--seeds', '1', '--out', out], { timeout: 60_000, encoding: 'utf8' })
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'))
    assert.equal(summary.mode, 'hard-ai-solo')
    assert.equal(summary.baseline.runs.length, 24)
    assert.equal(new Set(summary.baseline.runs.map(run => run.fingerprint)).size, 6)
    assert.ok(summary.baseline.runs.every(run => run.status === 'finished' && run.seconds > 0))
    const fastAsphalt = summary.baseline.runs.filter(run => run.scenarioId === 'balance-fast-street')
      .sort((a, b) => a.seconds - b.seconds)
    assert.deepEqual(fastAsphalt.map(run => run.car), ['red', 'blue', 'green', 'yellow'])
    assert.ok(fastAsphalt.every(run => run.recoveries === 0))
    assert.ok(summary.runtime.wallMs > 0 && summary.runtime.simulatedSeconds > 0)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
