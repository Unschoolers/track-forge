// Spread neighboring tests across shards instead of assigning contiguous blocks.
// Playwright discovers the tests, so additions are included automatically.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [shardText, totalText, output] = process.argv.slice(2)
const shard = Number(shardText)
const total = Number(totalText)
if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 1 || shard > total || !output) {
  throw new Error('Usage: node qa/browser/shard-list.mjs <shard> <total> <output>')
}

const discovery = JSON.parse(execFileSync(process.execPath, [
  'node_modules/playwright/cli.js', 'test', '--config=playwright.mobile.config.mjs',
  '--list', '--reporter=json',
], { encoding: 'utf8' }))
const tests = []
function collect(suite, titles = []) {
  for (const spec of suite.specs ?? []) {
    const parts = [spec.file, ...titles, spec.title]
    if (parts.some(part => /[>›\n\r]/.test(part))) throw new Error(`Unsupported test-list name: ${parts.join(' / ')}`)
    tests.push(parts.join(' › '))
  }
  for (const child of suite.suites ?? []) collect(child, [...titles, child.title])
}
for (const file of discovery.suites) collect(file)
if (new Set(tests).size !== tests.length) throw new Error('Test titles must be unique within each file')
const selected = tests.filter((_, index) => index % total === shard - 1)
if (!selected.length) throw new Error(`Shard ${shard}/${total} has no tests`)
writeFileSync(output, `${selected.join('\n')}\n`)
console.log(`Selected ${selected.length} of ${tests.length} tests for shard ${shard}/${total}`)
