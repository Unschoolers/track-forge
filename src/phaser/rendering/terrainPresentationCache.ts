interface WeightedCacheEntry<Value> {
  readonly value: Value
  readonly weight: number
}

/**
 * Small LRU keyed by immutable object identity. Unlike a WeakMap, the cache can
 * explicitly release heavy values when their aggregate presentation weight is
 * no longer safe to retain.
 */
export class WeightedIdentityCache<Key extends object, Value> {
  private readonly entries = new Map<Key, WeightedCacheEntry<Value>>()
  private retainedWeight = 0

  constructor(private readonly maximumWeight: number) {
    if (!Number.isFinite(maximumWeight) || maximumWeight <= 0) {
      throw new Error('Weighted cache maximum must be positive')
    }
  }

  get size(): number {
    return this.entries.size
  }

  get weight(): number {
    return this.retainedWeight
  }

  get(key: Key): Value | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: Key, value: Value, weight: number): void {
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error('Weighted cache entry weight must be positive')
    }
    const existing = this.entries.get(key)
    if (existing) {
      this.entries.delete(key)
      this.retainedWeight -= existing.weight
    }
    if (weight > this.maximumWeight) return

    this.entries.set(key, { value, weight })
    this.retainedWeight += weight
    while (this.retainedWeight > this.maximumWeight) {
      const oldest = this.entries.entries().next().value
      if (!oldest) break
      const [oldestKey, oldestEntry] = oldest
      this.entries.delete(oldestKey)
      this.retainedWeight -= oldestEntry.weight
    }
  }

  clear(): void {
    this.entries.clear()
    this.retainedWeight = 0
  }
}
