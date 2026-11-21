import { describe, expect, it } from 'vitest'
import { DEFAULT_CUP_TRACK_IDS, cupTrackIds, createCup } from '@/application/race/circuitCup'
import { BrowserCupRepository } from '@/infrastructure/storage/cupRepository'
import type { KeyValueStore } from '@/application/ports/storage'

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>()
  return {
    get: key => data.get(key) ?? null,
    set: (key, value) => { data.set(key, value); return true },
    remove: key => data.delete(key),
  }
}

describe('Cup lineup persistence', () => {
  it('remembers the most recently built lineup independently of the unfinished cup', () => {
    const repo = new BrowserCupRepository(memoryStore())
    expect(repo.load().lineup).toEqual(DEFAULT_CUP_TRACK_IDS)
    const checkpoint = createCup('blue', 'hard', ['official-meadow', 'official-frost'])
    expect(repo.save({ checkpoint, bestPlacement: null, lineup: ['official-bridge'] })).toBe(true)
    const reloaded = repo.load()
    expect(reloaded.lineup).toEqual(['official-bridge'])
    expect(cupTrackIds(reloaded.checkpoint!)).toEqual(['official-meadow', 'official-frost'])
    expect(reloaded.checkpoint?.index).toBe(0)
    expect(repo.save({ checkpoint: null, bestPlacement: null, lineup: [] })).toBe(true)
    expect(repo.load().lineup).toEqual([])
  })

  it('migrates the original four-round checkpoint and rejects corrupt lineups', () => {
    const store = memoryStore()
    store.set('trackforge-cup-v1', JSON.stringify({
      version: 1, bestPlacement: 2,
      checkpoint: { car: 'blue', difficulty: 'normal', index: 1,
        rounds: [[{ id: 'player', label: 'You', points: 10 }]] },
    }))
    const repo = new BrowserCupRepository(store)
    const progress = repo.load()
    expect(progress.bestPlacement).toBe(2)
    expect(cupTrackIds(progress.checkpoint!)).toEqual(DEFAULT_CUP_TRACK_IDS)
    expect(progress.lineup).toEqual(DEFAULT_CUP_TRACK_IDS)
    store.set('trackforge-cup-v1', JSON.stringify({
      version: 1, bestPlacement: 2,
      lineup: Array(200).fill('huge'),
      checkpoint: { car: 'blue', difficulty: 'normal', index: 20, rounds: [], trackIds: ['official-meadow'] },
    }))
    expect(repo.load()).toEqual({ checkpoint: null, bestPlacement: 2, lineup: DEFAULT_CUP_TRACK_IDS })
  })
})
