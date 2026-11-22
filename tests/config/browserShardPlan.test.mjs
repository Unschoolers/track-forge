import { describe, expect, it } from 'vitest'
import { planBrowserShard } from '../../qa/browser/shardPlan.mjs'

const suites = [
  {
    specs: [
      { file: 'qa/browser/a.spec.mjs', title: 'first' },
      { file: 'qa/browser/a.spec.mjs', title: 'second' },
    ],
    suites: [
      { title: 'nested', specs: [{ file: 'qa/browser/a.spec.mjs', title: 'third' }] },
    ],
  },
  { specs: [{ file: 'qa/browser/b.spec.mjs', title: 'fourth' }] },
]

describe('deterministic browser QA sharding', () => {
  it('assigns each nested spec to exactly one balanced shard without changing order', () => {
    const first = planBrowserShard(suites, 1, 2)
    const second = planBrowserShard(suites, 2, 2)
    expect(first.selected).toEqual([
      'qa/browser/a.spec.mjs › first',
      'qa/browser/a.spec.mjs › nested › third',
    ])
    expect(second.selected).toEqual([
      'qa/browser/a.spec.mjs › second',
      'qa/browser/b.spec.mjs › fourth',
    ])
    expect(first.total).toBe(4)
    expect(second.total).toBe(4)
    expect(new Set([...first.selected, ...second.selected]).size).toBe(4)
  })

  it('fails loudly for duplicated titles and unsupported test-list delimiters', () => {
    expect(() => planBrowserShard([{ specs: [
      { file: 'same.spec.mjs', title: 'repeat' },
      { file: 'same.spec.mjs', title: 'repeat' },
    ] }], 1, 2)).toThrow('unique')
    expect(() => planBrowserShard([{ specs: [
      { file: 'bad.spec.mjs', title: 'line\nbreak' },
    ] }], 1, 1)).toThrow('Unsupported')
  })

  it('rejects invalid and empty shard selections', () => {
    for (const [shard, total] of [[0, 2], [3, 2], [1, 0], [1.5, 2], [1, Number.NaN]]) {
      expect(() => planBrowserShard(suites, shard, total)).toThrow()
    }
    expect(() => planBrowserShard(suites, 4, 4)).not.toThrow()
    expect(() => planBrowserShard(suites.slice(0, 1), 4, 4)).toThrow('no tests')
  })
})
