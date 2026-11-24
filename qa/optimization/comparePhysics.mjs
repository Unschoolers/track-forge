import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [beforePath, afterPath] = process.argv.slice(2)
if (!beforePath || !afterPath) throw new Error('Usage: comparePhysics.mjs BEFORE AFTER')
const before = JSON.parse(readFileSync(beforePath, 'utf8'))
const after = JSON.parse(readFileSync(afterPath, 'utf8'))
if (JSON.stringify(before.scenarios) !== JSON.stringify(after.scenarios))
  throw new Error('Physics comparison requires identical scenarios')
const key = row => JSON.stringify([row.car, row.playerCar, row.focusRole, row.opponentCar,
  row.duelOpponentSpeedLimit, row.scenarioId, row.seed, row.mode])
const baseline = new Map(before.baselineMatrix.map(row => [key(row), row]))
const seen = new Set()
const comparisons = after.baselineMatrix.map(row => {
  const id = key(row)
  const old = baseline.get(id)
  if (!old || seen.has(id)) throw new Error('Unmatched or duplicate trial: ' + id)
  seen.add(id)
  const deltaSeconds = Number.isFinite(old.seconds) && Number.isFinite(row.seconds)
    ? row.seconds - old.seconds : null
  const deltaPercent = deltaSeconds === null || old.seconds <= 0
    ? null : 100 * deltaSeconds / old.seconds
  const regression = (Number.isFinite(old.seconds) && !Number.isFinite(row.seconds)) ||
    row.recoveries > old.recoveries || (deltaPercent !== null && deltaPercent > 1)
  return { ...row, beforeSeconds: old.seconds, beforeRecoveries: old.recoveries,
    deltaSeconds, deltaPercent, regression }
})
if (seen.size !== baseline.size || baseline.size !== before.baselineMatrix.length)
  throw new Error('Physics comparison matrix is incomplete')
const regressions = comparisons.filter(row => row.regression)
const summary = { beforeRevision: before.physicsRevision, afterRevision: after.physicsRevision,
  comparisons, regressions }
writeFileSync(join(dirname(afterPath), 'physics-comparison.json'), JSON.stringify(summary, null, 2))
for (const car of [...new Set(comparisons.map(row => row.car))]) {
  const rows = comparisons.filter(row => row.car === car)
  const valid = rows.filter(row => row.deltaPercent !== null)
  const mean = valid.length ? valid.reduce((sum, row) => sum + row.deltaPercent, 0) / valid.length : null
  console.log(JSON.stringify({ car, trials: rows.length, meanDeltaPercent: mean,
    regressions: rows.filter(row => row.regression).length }))
}
if (regressions.length) {
  console.error(JSON.stringify(regressions))
  process.exitCode = 1
}
