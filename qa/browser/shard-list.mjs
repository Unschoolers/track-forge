// Spread neighboring tests across shards instead of assigning contiguous blocks.
// Playwright discovers the tests, so additions are included automatically.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { planBrowserShard } from './shardPlan.mjs'

const [shardText, totalText, output] = process.argv.slice(2)
const shard = Number(shardText)
const total = Number(totalText)
// Fail before starting Playwright discovery for an invalid runner request.
if (!output || !Number.isInteger(shard) || !Number.isInteger(total) ||
    shard < 1 || shard > total) {
  throw new Error('Usage: node qa/browser/shard-list.mjs <shard> <total> <output>')
}

const discovery = JSON.parse(execFileSync(process.execPath, [
  'node_modules/playwright/cli.js', 'test', '--config=playwright.mobile.config.mjs',
  '--list', '--reporter=json',
], { encoding: 'utf8' }))
const { selected, total: testCount } = planBrowserShard(discovery.suites, shard, total)
writeFileSync(output, `${selected.join('\n')}\n`)
console.log(`Selected ${selected.length} of ${testCount} tests for shard ${shard}/${total}`)
