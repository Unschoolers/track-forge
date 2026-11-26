import type { TrackStore } from '@/application/ports/storage'
import type { Track, TrackId } from '@/domain/model'
import { decodeTrack } from '@/domain/track/trackCodec'
import { isSharedTrack } from '@/domain/track/trackAccess'
import { BrowserTrackRepository } from './trackRepository'
import { STORAGE_KEYS } from './storageKeys'

const DATABASE = 'trackforge-track-library'
const TRACKS = 'tracks'
const BACKUP = 'legacyBackup'
const LEGACY_KEYS = [STORAGE_KEYS.tracks, STORAGE_KEYS.legacyTracks, STORAGE_KEYS.trackMigration, ...STORAGE_KEYS.legacyAutosaves]

type LegacyRecord = { key: string; value: string }

function errorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
    ? error.name : 'storage_error'
}

function readAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request: IDBRequest<T[]> = db.transaction(store, 'readonly').objectStore(store).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not read track storage.'))
  })
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Track transaction aborted.', 'AbortError'))
  })
}

function openDatabase(factory: IDBFactory, legacy: Storage): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1)
    let blocked = false
    let migrationError: unknown
    request.onupgradeneeded = () => {
      try {
        const db = request.result
        const trackStore = db.createObjectStore(TRACKS, { keyPath: 'id' })
        const backup = db.createObjectStore(BACKUP, { keyPath: 'key' })
        const snapshot = new Map<string, string | null>(LEGACY_KEYS.map(key => [key, legacy.getItem(key)]))
        const source = new BrowserTrackRepository({
          get: key => snapshot.get(key) ?? null,
          set: () => false,
          remove: () => false,
        })
        // Schema, normalized tracks and exact source are committed together.
        for (const track of source.readForMigration()) trackStore.put(track)
        for (const [key, value] of snapshot) if (value !== null) backup.put({ key, value })
      } catch (error) {
        migrationError = error
        request.transaction?.abort()
      }
    }
    request.onblocked = () => {
      blocked = true
      reject(new Error('Track storage is blocked by another open game window.'))
    }
    request.onerror = () => reject(migrationError ?? request.error ?? new Error('Could not open track storage.'))
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
  })
}

/** Hydrated reads stay synchronous; writes publish to the cache only on commit. */
export class IndexedDbTrackRepository implements TrackStore {
  private failure: string | null = null
  private readonly tracks = new Map<TrackId, Track>()

  private constructor(private readonly db: IDBDatabase, tracks: readonly Track[]) {
    for (const track of tracks) this.tracks.set(track.id, track)
    db.onversionchange = () => db.close()
  }

  static async open(legacy: Storage = window.localStorage, factory: IDBFactory = indexedDB): Promise<IndexedDbTrackRepository> {
    const db = await openDatabase(factory, legacy)
    try {
      const records = await readAll<unknown>(db, TRACKS)
      const tracks = records.map(value => decodeTrack(value, Date.now()))
      if (tracks.some(track => track === undefined)) throw new Error('Invalid persisted track record; original data retained.')
      const repository = new IndexedDbTrackRepository(db, tracks.filter(track => track !== undefined))
      // Free the old quota only after reading the committed database. Keep an
      // exact backup. Never remove a source that changed since migration.
      for (const { key, value } of await readAll<LegacyRecord>(db, BACKUP)) {
        try {
          if (legacy.getItem(key) === value) legacy.removeItem(key)
        } catch (error) {
          console.error('Could not clean up migrated track storage.', errorName(error))
        }
      }
      return repository
    } catch (error) {
      db.close()
      throw error
    }
  }

  list(): readonly Track[] {
    return [...this.tracks.values()].map(track => structuredClone(track))
  }

  find(id: TrackId): Track | undefined {
    const track = this.tracks.get(id)
    return track ? structuredClone(track) : undefined
  }

  failureReason(): string | null { return this.failure }

  save(track: Track): Promise<boolean> { return this.saveMany([track]) }

  async saveMany(tracks: readonly Track[]): Promise<boolean> {
    const normalized = tracks.map(track => decodeTrack(track, Date.now()))
    if (normalized.some(track => track === undefined)) {
      this.failure = 'invalid_track'
      return false
    }
    const valid = normalized.filter(track => track !== undefined)
    if (new Set(valid.map(track => track.id)).size !== valid.length) {
      this.failure = 'duplicate_track_id'
      return false
    }
    let readOnlyCollision = false
    return this.write(store => {
      // Read the persisted record inside the same transaction to protect
      // originals saved by another window after this cache was hydrated.
      const transaction = store.transaction
      for (const track of valid) {
        const request: IDBRequest<Track | undefined> = store.get(track.id)
        request.onsuccess = () => {
          if (isSharedTrack(request.result)) {
            readOnlyCollision = true
            transaction.abort()
          } else {
            store.put(track)
          }
        }
      }
    }, () => {
      for (const track of valid) this.tracks.set(track.id, track)
    }, () => readOnlyCollision ? 'read_only_track' : null)
  }

  remove(id: TrackId): Promise<boolean> {
    return this.write(store => { store.delete(id) }, () => { this.tracks.delete(id) })
  }

  private async write(
    enqueue: (store: IDBObjectStore) => void,
    apply: () => void,
    rejection?: () => string | null,
  ): Promise<boolean> {
    this.failure = null
    try {
      const transaction = this.db.transaction(TRACKS, 'readwrite')
      const completion = committed(transaction)
      try {
        enqueue(transaction.objectStore(TRACKS))
      } catch (error) {
        transaction.abort()
        // Wait for abort but report the original synchronous cause.
        await completion.catch(() => undefined)
        throw error
      }
      await completion
      apply()
      return true
    } catch (error) {
      const expectedRejection = rejection?.()
      this.failure = expectedRejection ?? errorName(error)
      if (!expectedRejection) console.error('Track storage write failed.', this.failure)
      return false
    }
  }
}
