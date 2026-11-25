import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBalanceReport } from './report.mjs'

const scenarios = [{ id: 'a', layout: 'loop', surface: 'road' }, { id: 'b', layout: 'turn', surface: 'ice' }]
const cars = ['red', 'green', 'blue', 'yellow']
const run = (scenarioId, car, seed, seconds, extra = {}) => ({ scenarioId, car, seed, seconds, status: 'finished', recoveries: 0, ...extra })
const runs = () => scenarios.flatMap(({ id }) => cars.flatMap((car, i) => [1, 2].map(seed => run(id, car, seed, (id === 'a' ? 10 : 100) * (i + 1)))))

test('scores all six pairs with equal scenario weight and retains the raw measurements', () => {
  const input = runs()
  const report = buildBalanceReport(scenarios, input, { seeds: [1, 2] })
  assert.deepEqual(report.runs, input)
  assert.equal(report.complete, true)
  assert.equal(report.pairs.length, 6)
  const pair = report.pairs.find(p => p.carA === 'red' && p.carB === 'green')
  assert.deepEqual(pair.scenarios.map(s => [s.meanSecondsA, s.meanSecondsB, s.differenceSeconds, s.differencePercent]), [[10, 20, -10, -50], [100, 200, -100, -50]])
  assert.equal(pair.geometricMeanRatio, 0.5)
  assert.equal(pair.overallDifferencePercent, -50)
})

test('missing, failed and duplicate trials cannot silently contribute to an overall score', () => {
  const input = runs().filter(r => !(r.scenarioId === 'a' && r.car === 'blue' && r.seed === 1))
  input.find(r => r.scenarioId === 'b' && r.car === 'red' && r.seed === 1).status = 'timeout'
  input.push({ ...input[0] })
  const report = buildBalanceReport(scenarios, input, { seeds: [1, 2] })
  assert.equal(report.complete, false)
  assert.ok(report.issues.some(i => i.type === 'missing'))
  assert.ok(report.issues.some(i => i.type === 'duplicate'))
  assert.ok(report.issues.some(i => i.type === 'failed'))
  assert.equal(report.pairs.find(p => p.carA === 'red' && p.carB === 'blue').geometricMeanRatio, null)
})

test('rejects malformed or unmatched input and prevents fingerprint mismatches', () => {
  const input = runs()
  input[0].seconds = 0
  input[1].fingerprint = 'one'
  input[5].fingerprint = 'two'
  input.push(run('unknown', 'red', 1, 12))
  const report = buildBalanceReport(scenarios, input, { seeds: [1, 2] })
  assert.ok(report.issues.some(i => i.type === 'invalid-run'))
  assert.ok(report.issues.some(i => i.type === 'unexpected-run'))
  assert.ok(report.issues.some(i => i.type === 'fingerprint-mismatch'))
  assert.throws(() => buildBalanceReport(scenarios, [], { seeds: [1, 1] }), /seeds/i)
  assert.throws(() => buildBalanceReport([...scenarios, scenarios[0]], []), /scenario/i)
})

test('geometric aggregate weights scenarios equally instead of letting long tracks dominate', () => {
  const input = runs().map(r => r.scenarioId === 'b' && r.car === 'red' ? { ...r, seconds: 200 } : r)
  const pair = buildBalanceReport(scenarios, input, { seeds: [1, 2] }).pairs[0]
  assert.ok(Math.abs(pair.geometricMeanRatio - Math.sqrt(0.5)) < 1e-12)
})
