import type {
  KeyValueStore,
  ScoreEntry,
  ScoreStore,
} from '@/application/ports/storage'
import {
  isCarId,
  isDifficultyId,
  type TrackId,
} from '@/domain/model'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'

function decodeScore(value: unknown): ScoreEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const item = value as Record<string, unknown>
  return typeof item.time === 'number' &&
    Number.isFinite(item.time) &&
    isCarId(item.car) &&
    isDifficultyId(item.difficulty) &&
    ((typeof item.recordedAt === 'number' &&
      Number.isFinite(item.recordedAt)) ||
      (typeof item.date === 'number' && Number.isFinite(item.date)))
    ? {
        time: item.time,
        car: item.car,
        difficulty: item.difficulty,
        recordedAt:
          typeof item.recordedAt === 'number'
            ? item.recordedAt
            : (item.date as number),
      }
    : undefined
}

export class BrowserScoreRepository implements ScoreStore {
  constructor(private readonly storage: KeyValueStore) {}

  forTrack(trackId: TrackId): readonly ScoreEntry[] {
    const all = this.read()
    const raw = all[trackId]
    return Array.isArray(raw)
      ? raw
          .map(decodeScore)
          .filter((score) => score !== undefined)
          .sort((left, right) => left.time - right.time)
          .slice(0, 5)
      : []
  }

  record(trackId: TrackId, score: ScoreEntry): boolean {
    if (!decodeScore(score)) return false
    const all = this.read()
    all[trackId] = [...this.forTrack(trackId), score]
      .sort((left, right) => left.time - right.time)
      .slice(0, 5)
    return this.storage.set(STORAGE_KEYS.scores, JSON.stringify(all))
  }

  removeTrack(trackId: TrackId): boolean {
    const all = this.read()
    delete all[trackId]
    return this.storage.set(STORAGE_KEYS.scores, JSON.stringify(all))
  }

  private read(): Record<string, unknown> {
    const current = this.parseRecord(this.storage.get(STORAGE_KEYS.scores))
    if (this.storage.get(STORAGE_KEYS.scoreMigration) === '1') {
      return current
    }
    const legacy = this.parseRecord(
      this.storage.get(STORAGE_KEYS.legacyScores),
    )
    const merged = this.mergeRecords(legacy, current)
    if (this.storage.set(STORAGE_KEYS.scores, JSON.stringify(merged))) {
      this.storage.set(STORAGE_KEYS.scoreMigration, '1')
    }
    return merged
  }

  private parseRecord(value: string | null): Record<string, unknown> {
    try {
      const parsed = JSON.parse(value ?? '{}') as unknown
      return typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }

  private mergeRecords(
    legacy: Record<string, unknown>,
    current: Record<string, unknown>,
  ): Record<string, readonly ScoreEntry[]> {
    const merged: Record<string, readonly ScoreEntry[]> = {}
    for (const trackId of new Set([
      ...Object.keys(legacy),
      ...Object.keys(current),
    ])) {
      const legacyScores = Array.isArray(legacy[trackId])
        ? legacy[trackId]
        : []
      const currentScores = Array.isArray(current[trackId])
        ? current[trackId]
        : []
      const unique = new Map<string, ScoreEntry>()
      for (const raw of [...legacyScores, ...currentScores]) {
        const score = decodeScore(raw)
        if (!score) continue
        const identity = [
          score.time,
          score.car,
          score.difficulty,
          score.recordedAt,
        ].join(':')
        unique.set(identity, score)
      }
      const scores = [...unique.values()]
        .sort((left, right) => left.time - right.time)
        .slice(0, 5)
      if (scores.length > 0) merged[trackId] = scores
    }
    return merged
  }
}
