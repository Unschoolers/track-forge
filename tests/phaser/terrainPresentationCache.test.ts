import { describe, expect, it } from 'vitest'
import { WeightedIdentityCache } from '@/phaser/rendering/terrainPresentationCache'

describe('weighted identity cache', () => {
  it('evicts least-recently-used identities before exceeding its weight', () => {
    const cache = new WeightedIdentityCache<object, string>(20)
    const first = {}
    const second = {}
    const third = {}

    cache.set(first, 'first', 10)
    cache.set(second, 'second', 10)
    expect(cache.get(first)).toBe('first')
    cache.set(third, 'third', 10)

    expect(cache.get(first)).toBe('first')
    expect(cache.get(second)).toBeUndefined()
    expect(cache.get(third)).toBe('third')
    expect(cache.weight).toBe(20)
    expect(cache.size).toBe(2)
  })

  it('returns but does not retain an entry heavier than the whole cache', () => {
    const cache = new WeightedIdentityCache<object, string>(10)
    const identity = {}

    cache.set(identity, 'large', 11)

    expect(cache.get(identity)).toBeUndefined()
    expect(cache.weight).toBe(0)
    expect(cache.size).toBe(0)
  })
})
