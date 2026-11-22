/** A pure, deterministic contract for the browser QA runner's --test-list. */
export function planBrowserShard(suites, shard, total) {
  if (!Number.isInteger(shard) || !Number.isInteger(total) ||
      shard < 1 || shard > total) {
    throw new Error('Invalid browser QA shard index or count')
  }

  const tests = []
  function collect(suite, titles = []) {
    for (const spec of suite.specs ?? []) {
      const parts = [spec.file, ...titles, spec.title]
      if (parts.some(part => /[>›\n\r]/.test(part))) {
        throw new Error(`Unsupported test-list name: ${parts.join(' / ')}`)
      }
      tests.push(parts.join(' › '))
    }
    for (const child of suite.suites ?? []) collect(child, [...titles, child.title])
  }
  for (const suite of suites) collect(suite)

  if (new Set(tests).size !== tests.length) {
    throw new Error('Test titles must be unique within each file')
  }
  const selected = tests.filter((_, index) => index % total === shard - 1)
  if (!selected.length) throw new Error(`Shard ${shard}/${total} has no tests`)
  return { selected, total: tests.length }
}
