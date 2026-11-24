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
    const checkpoint = createCup('blue', 'hard', ['official-city-sprint', 'official-desert-sweep'])
    expect(repo.save({ checkpoint, bestPlacement: null, lineup: ['official-toy-box'] })).toBe(true)
    const reloaded = repo.load()
    expect(reloaded.lineup).toEqual(['official-toy-box'])
    expect(cupTrackIds(reloaded.checkpoint!)).toEqual(['official-city-sprint', 'official-desert-sweep'])
    expect(reloaded.checkpoint?.index).toBe(0)
    expect(repo.save({ checkpoint: null, bestPlacement: null, lineup: [] })).toBe(true)
    expect(repo.load().lineup).toEqual([])
  })

  it('retires the old implicit four-round checkpoint and rejects corrupt lineups', () => {
    const store = memoryStore()
    store.set('trackforge-cup-v1', JSON.stringify({
      version: 1, bestPlacement: 2,
      checkpoint: { car: 'blue', difficulty: 'normal', index: 1,
        rounds: [[{ id: 'player', label: 'You', points: 10 }]] },
    }))
    const repo = new BrowserCupRepository(store)
    const progress = repo.load()
    expect(progress.bestPlacement).toBe(2)
    expect(progress.checkpoint).toBeNull()
    expect(progress.lineup).toEqual(DEFAULT_CUP_TRACK_IDS)
    store.set('trackforge-cup-v1', JSON.stringify({
      version: 1, bestPlacement: 2,
      lineup: Array(200).fill('huge'),
      checkpoint: { car: 'blue', difficulty: 'normal', index: 20, rounds: [], trackIds: ['official-meadow'] },
    }))
    expect(repo.load()).toEqual({ checkpoint: null, bestPlacement: 2, lineup: DEFAULT_CUP_TRACK_IDS })
  })
  it('migrates retired official IDs while retaining custom Cups and their best placement', () => {
    const storage = memoryStore()
    storage.set('trackforge-cup-v1', JSON.stringify({
      version: 1, bestPlacement: 2,
      lineup: ['official-meadow', 'my-authored-track', 'official-frost'],
      checkpoint: {
        car: 'blue', difficulty: 'normal', index: 0, rounds: [],
        trackIds: ['my-authored-track'],
      },
    }))
    const repo = new BrowserCupRepository(storage)
    expect(repo.load()).toMatchObject({
      bestPlacement: 2, lineup: ['my-authored-track'],
      checkpoint: { trackIds: ['my-authored-track'] },
    })
    storage.set('trackforge-cup-v1', JSON.stringify({
      version: 1, bestPlacement: 1,
      lineup: ['official-meadow', 'official-frost'],
      checkpoint: null,
    }))
    expect(repo.load()).toEqual({
      bestPlacement: 1, checkpoint: null, lineup: DEFAULT_CUP_TRACK_IDS,
    })
  })

})
