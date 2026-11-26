import { describe, expect, it } from 'vitest'
import { BrowserPreferencesRepository } from '@/infrastructure/storage/preferencesRepository'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'
import type { KeyValueStore } from '@/application/ports/storage'

class FailingStore implements KeyValueStore {
  readonly values = new Map<string, string>()
  readonly failed = new Set<string>()
  get(key: string) { return this.values.get(key) ?? null }
  set(key: string, value: string) {
    if (this.failed.has(key)) return false
    this.values.set(key, value)
    return true
  }
  remove(key: string) { return this.values.delete(key) }
}

describe('durable preferences snapshot', () => {
  it('keeps the last complete snapshot when the next save cannot commit', () => {
    const store = new FailingStore()
    const repo = new BrowserPreferencesRepository(store)
    expect(repo.save({ ...repo.load(), car: 'red' })).toBe(true)
    const first = store.values.get(STORAGE_KEYS.preferencesSnapshot)
    store.failed.add(STORAGE_KEYS.preferencesSnapshot)
    expect(repo.save({ ...repo.load(), car: 'yellow', raceLaps: 3 })).toBe(false)
    expect(store.values.get(STORAGE_KEYS.preferencesSnapshot)).toBe(first)
    expect(new BrowserPreferencesRepository(store).load()).toMatchObject({ car: 'red', raceLaps: 2 })
  })

  it('loads the durable snapshot even when a legacy mirror write is denied', () => {
    const store = new FailingStore()
    const repo = new BrowserPreferencesRepository(store)
    expect(repo.save({ ...repo.load(), car: 'blue' })).toBe(true)
    store.failed.add(STORAGE_KEYS.car)
    expect(repo.save({ ...repo.load(), car: 'green', raceLaps: 1 })).toBe(true)
    expect(store.values.get(STORAGE_KEYS.car)).toBe('blue')
    expect(new BrowserPreferencesRepository(store).load()).toMatchObject({ car: 'green', raceLaps: 1 })
  })

  it('preserves legacy committed settings and defaults quality, then persists new choices', () => {
    const store = new FailingStore()
    const repo = new BrowserPreferencesRepository(store)
    expect(repo.save({ ...repo.load(), car: 'red', graphicsQuality: 'high' })).toBe(true)
    expect(repo.load().graphicsQuality).toBe('high')
    const raw = store.get(STORAGE_KEYS.preferencesSnapshot)
    if (!raw) throw new Error('Missing committed preferences')
    const snapshot = JSON.parse(raw) as { values: Record<string, string> }
    delete snapshot.values[STORAGE_KEYS.graphicsQuality]
    store.values.set(STORAGE_KEYS.preferencesSnapshot, JSON.stringify(snapshot))
    store.values.set(STORAGE_KEYS.car, 'green')
    expect(repo.load()).toMatchObject({ car: 'red', graphicsQuality: 'medium' })
    expect(repo.save({ ...repo.load(), graphicsQuality: 'low' })).toBe(true)
    expect(new BrowserPreferencesRepository(store).load().graphicsQuality).toBe('low')
  })

  it('recovers safely from malformed snapshot while retaining legacy preference decoding', () => {
    const store = new FailingStore()
    store.values.set(STORAGE_KEYS.car, 'yellow')
    store.values.set(STORAGE_KEYS.preferencesSnapshot, '{invalid')
    const repo = new BrowserPreferencesRepository(store)
    expect(repo.load().car).toBe('yellow')
    store.values.set(STORAGE_KEYS.preferencesSnapshot, JSON.stringify({ version: 1, values: { [STORAGE_KEYS.car]: 42 } }))
    expect(repo.load().car).toBe('yellow')
  })
})
