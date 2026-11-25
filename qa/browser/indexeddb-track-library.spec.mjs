import { expect, test } from '@playwright/test'

async function storagePage(page) {
  await page.route('**/storage-regression', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Track storage regression</title>',
  }))
  await page.goto('/storage-regression')
}

test('migrates large legacy tracks, exceeds the old quota and preserves committed records on reload', async ({ page }) => {
  await storagePage(page)
  const result = await page.evaluate(async () => {
    const { IndexedDbTrackRepository } = await import('/src/infrastructure/storage/indexedDbTrackRepository.ts')
    const { createStarterTrack } = await import('/src/domain/track/starterTrack.ts')
    const cells = Array.from({ length: 20_000 }, (_, index) => ({
      column: index % 200, row: Math.floor(index / 200), kind: 'hill',
    }))
    const source = {
      ...createStarterTrack('legacy-large', 42),
      origin: 'local', name: 'Large legacy track', raceRevision: 77,
      creator: { id: 'qa-owner', name: 'QA Owner' },
      terrain: { cellSize: 32, cells },
    }
    const raw = JSON.stringify([source])
    localStorage.setItem('trackforge-library-v2', raw)
    localStorage.setItem('trackforge-library-v1-migrated', '1')
    localStorage.setItem('trackforge-highscores-v3', 'preserve-scores')
    const repo = await IndexedDbTrackRepository.open()
    const before = repo.find(source.id)
    const copies = Array.from({ length: 8 }, (_, i) => ({
      ...source, id: 'copy-' + i, name: 'Copy ' + i, origin: 'imported',
    }))
    const committed = await repo.saveMany(copies)
    const bytes = new TextEncoder().encode(JSON.stringify(repo.list())).length
    const put = IDBObjectStore.prototype.put
    let aborted
    try {
      IDBObjectStore.prototype.put = function (value, ...args) {
        const request = put.call(this, value, ...args)
        if (value.id === 'aborted') this.transaction.abort()
        return request
      }
      aborted = await repo.save({ ...source, id: 'aborted' })
    } finally {
      IDBObjectStore.prototype.put = put
    }
    const reason = repo.failureReason()
    const absent = !repo.find('aborted')
    const removed = await repo.remove('copy-0')
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('trackforge-track-library', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const backup = await new Promise((resolve, reject) => {
      const request = db.transaction('legacyBackup').objectStore('legacyBackup').get('trackforge-library-v2')
      request.onsuccess = () => resolve(request.result?.value)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return {
      revision: before?.raceRevision, creator: before?.creator, terrainCells: before?.terrain.cells.length,
      committed, bytes, aborted, reason, absent, removed,
      backupMatches: backup === raw, legacyRemoved: localStorage.getItem('trackforge-library-v2') === null,
      scoresPreserved: localStorage.getItem('trackforge-highscores-v3') === 'preserve-scores',
    }
  })
  expect(result).toMatchObject({
    revision: 77, creator: { id: 'qa-owner', name: 'QA Owner' }, terrainCells: 20_000,
    committed: true, aborted: false, reason: 'AbortError', absent: true, removed: true,
    backupMatches: true, legacyRemoved: true, scoresPreserved: true,
  })
  expect(result.bytes).toBeGreaterThan(5 * 1024 * 1024)
  await page.reload()
  const persisted = await page.evaluate(async () => {
    const { IndexedDbTrackRepository } = await import('/src/infrastructure/storage/indexedDbTrackRepository.ts')
    const repo = await IndexedDbTrackRepository.open()
    return repo.list().map(track => ({ id: track.id, revision: track.raceRevision }))
  })
  expect(persisted).toHaveLength(8)
  expect(persisted).toContainEqual({ id: 'legacy-large', revision: 77 })
  expect(persisted.map(track => track.id)).not.toContain('aborted')
  expect(persisted.map(track => track.id)).not.toContain('copy-0')
})

test('keeps legacy data intact when the database migration aborts and retries safely', async ({ page }) => {
  await storagePage(page)
  const result = await page.evaluate(async () => {
    const { IndexedDbTrackRepository } = await import('/src/infrastructure/storage/indexedDbTrackRepository.ts')
    const { createStarterTrack } = await import('/src/domain/track/starterTrack.ts')
    const raw = JSON.stringify([createStarterTrack('legacy-retry', 42)])
    localStorage.setItem('trackforge-library-v2', raw)
    const put = IDBObjectStore.prototype.put
    let failure
    try {
      IDBObjectStore.prototype.put = function () {
        throw new DOMException('Injected migration failure', 'QuotaExceededError')
      }
      await IndexedDbTrackRepository.open()
    } catch (error) {
      failure = error.name
    } finally {
      IDBObjectStore.prototype.put = put
    }
    const sourceIntact = localStorage.getItem('trackforge-library-v2') === raw
    const repo = await IndexedDbTrackRepository.open()
    return { failure, sourceIntact, ids: repo.list().map(track => track.id) }
  })
  expect(result).toEqual({ failure: 'QuotaExceededError', sourceIntact: true, ids: ['legacy-retry'] })
})
