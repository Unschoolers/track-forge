import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { evaluatePair, trialKey, assessFleet, PHYSICS_ACCEPTANCE, applyTimingReview,
  hasIdenticalRecordedOutput } from './score.mjs'

const [beforePath, afterPath, ...flags] = process.argv.slice(2)
const reviewIndex = flags.indexOf('--timing-review')
const timingReview = reviewIndex < 0 ? null : JSON.parse(readFileSync(flags.splice(reviewIndex, 2)[1], 'utf8'))
if (flags.some(flag => !['--gameplay-improvement', '--behavior-preserving'].includes(flag)))
  throw new Error('Unknown physics comparison option')
if (flags.includes('--gameplay-improvement') && flags.includes('--behavior-preserving'))
  throw new Error('Gameplay-improvement and behavior-preserving classifications conflict')
if (!beforePath || !afterPath) throw new Error('Usage: comparePhysics.mjs BEFORE AFTER')
const before = JSON.parse(readFileSync(beforePath, 'utf8'))
const after = JSON.parse(readFileSync(afterPath, 'utf8'))
if (JSON.stringify(before.scenarios) !== JSON.stringify(after.scenarios))
  throw new Error('Physics comparison requires identical scenarios')
const records = path => JSON.parse(readFileSync(join(dirname(path), 'baseline-results.json'), 'utf8'))
const original = records(beforePath)
const baseline = new Map(original.map(item => [trialKey(item.task), item.result]))
const seen = new Set()
const behaviorPreserving = flags.includes('--behavior-preserving')
const comparisons = records(afterPath).map(({ task, result }) => {
  const id = trialKey(task)
  const old = baseline.get(id)
  if (!old || seen.has(id)) throw new Error('Unmatched or duplicate trial: ' + id)
  seen.add(id)
  if (behaviorPreserving && !hasIdenticalRecordedOutput(old, result))
    throw new Error(`Behavior-preserving comparison changed recorded output: ${id}`)
  const pair = applyTimingReview(evaluatePair(old, result, PHYSICS_ACCEPTANCE), task, timingReview, before.physicsRevision)
  return { ...pair, regression: !pair.eligible }
})
if (seen.size !== baseline.size || baseline.size !== original.length || baseline.size === 0)
  throw new Error('Physics comparison matrix is incomplete')
const regressions = comparisons.filter(row => row.regression)
const acceptance = assessFleet(comparisons, {
  gameplayImprovement: flags.includes('--gameplay-improvement'),
  requireBenefit: !behaviorPreserving,
})
const summary = { beforeRevision: before.physicsRevision, afterRevision: after.physicsRevision,
  policy: PHYSICS_ACCEPTANCE, acceptance, comparisons, regressions,
  timingReviews: comparisons.filter(row => row.timingReview) }
writeFileSync(join(dirname(afterPath), 'physics-comparison.json'), JSON.stringify(summary, null, 2))
for (const car of [...new Set(comparisons.map(row => row.car))]) {
  const rows = comparisons.filter(row => row.car === car)
  const valid = rows.filter(row => row.improvement !== null)
  const mean = valid.length ? -100 * valid.reduce((sum, row) => sum + row.improvement, 0) / valid.length : null
  console.log(JSON.stringify({ car, trials: rows.length, meanDeltaPercent: mean,
    recoveriesBefore: rows.reduce((sum, row) => sum + row.recoveriesBefore, 0),
    recoveriesAfter: rows.reduce((sum, row) => sum + row.recoveriesAfter, 0),
    regressions: rows.filter(row => row.regression).length }))
}
console.log('FLEET_ACCEPTANCE ' + JSON.stringify(acceptance))
for (const row of summary.timingReviews) console.log('APPROVED_TIMING_REVIEW ' + JSON.stringify(row))
if (!acceptance.eligible) {
  console.error(JSON.stringify(regressions))
  process.exitCode = 1
}
