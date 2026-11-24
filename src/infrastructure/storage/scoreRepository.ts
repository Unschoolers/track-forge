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
  const rawCategory = item.category
  const category = rawCategory && typeof rawCategory === 'object' ? rawCategory as Record<string, unknown> : undefined
  const validCategory = category && typeof category.course === 'string' && category.course.length > 0 &&
    typeof category.laps === 'number' && Number.isInteger(category.laps) && category.laps > 0 &&
    (category.mode === 'normal' || category.mode === 'ghost' || category.mode === 'time-trial')
  return typeof item.time === 'number' &&
    Number.isFinite(item.time) && item.time > 0 &&
    isCarId(item.car) &&
    isDifficultyId(item.difficulty) &&
    ((typeof item.recordedAt === 'number' &&
      Number.isFinite(item.recordedAt)) ||
      (typeof item.date === 'number' && Number.isFinite(item.date)))
    ? {
        time: item.time,
        ...(validCategory ? { category: { course: category.course as string, laps: category.laps as number, mode: category.mode as 'normal' | 'ghost' | 'time-trial', ...(category.routeKind === 'point-to-point' ? { routeKind: 'point-to-point' as const } : {}) } } : {}),
        car: item.car,
        difficulty: item.difficulty,
        recordedAt:
          typeof item.recordedAt === 'number'
            ? item.recordedAt
            : (item.date as number),
      }
    : undefined
}

// Uncategorised historical scores remain visible as legacy, not as race records.
// Explicit Simulation records must never enter the new Arcade leaderboard.
function decodeLegacyScore(raw: unknown): ScoreEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const category = (raw as Record<string, unknown>).category
  if (category != null && (typeof category !== 'object' ||
      (category as Record<string, unknown>).handling !== 'arcade')) return undefined
  const score = decodeScore(raw)
  return category != null && !score?.category ? undefined : score
}

function categoryKey(score: ScoreEntry): string {
  return score.category ? JSON.stringify([score.category.course, score.category.routeKind ?? 'circuit', score.category.laps, score.category.mode, score.car, score.difficulty]) : 'legacy'
}

/** Retain the five best scores per category with one accounting pass. */
function bestScores(scores: readonly ScoreEntry[]): ScoreEntry[] {
  const keptByCategory = new Map<string, number>()
  return [...scores]
    .sort((left, right) => left.time - right.time)
    .filter((score) => {
      const category = categoryKey(score)
      const kept = keptByCategory.get(category) ?? 0
      if (kept >= 5) return false
      keptByCategory.set(category, kept + 1)
      return true
    })
}

function decodedScores(raw: unknown): ScoreEntry[] {
  return Array.isArray(raw)
    ? raw.map(decodeScore).filter((score): score is ScoreEntry => score !== undefined)
    : []
}

export class BrowserScoreRepository implements ScoreStore {
  constructor(private readonly storage: KeyValueStore) {}

  forTrack(trackId: TrackId): readonly ScoreEntry[] {
    const all = this.read()
    return bestScores(decodedScores(all[trackId]))
  }

  record(trackId: TrackId, score: ScoreEntry): boolean {
    if (!decodeScore(score)) return false
    const all = this.read()
    // Use this same storage snapshot rather than re-reading and re-migrating it.
    all[trackId] = bestScores([...decodedScores(all[trackId]), score])
    return this.write(all)
  }

  removeTrack(trackId: TrackId): boolean {
    const all = this.read()
    delete all[trackId]
    return this.write(all)
  }

  // The migration flag is committed atomically with the records. A separate
  // marker could fail after a deletion and resurrect old scores on next load.
  private write(records: Record<string, unknown>): boolean {
    return this.storage.set(STORAGE_KEYS.scores, JSON.stringify({ version: 3, records }))
  }

  private read(): Record<string, unknown> {
    const current = this.parseRecord(this.storage.get(STORAGE_KEYS.scores))
    if (current.version === 3 && current.records && typeof current.records === 'object' &&
        !Array.isArray(current.records)) return current.records as Record<string, unknown>

    const previous = this.parseRecord(this.storage.get('trackforge-highscores-v2'))
    // V1 scores already merged into V2 must not be reimported after deletion.
    const oldest = this.storage.get('trackforge-highscores-v1-migrated') === '1'
      ? {} : this.parseRecord(this.storage.get('trackforge-highscores-v1'))
    const merged = new Map<string, ScoreEntry[]>()
    for (const trackId of new Set([...Object.keys(oldest), ...Object.keys(previous), ...Object.keys(current)])) {
      const unique = new Map<string, ScoreEntry>()
      for (const [bank, legacy] of [[oldest, true], [previous, true], [current, false]] as const) {
        const raw = bank[trackId]
        if (!Array.isArray(raw)) continue
        for (const item of raw) {
          const score = legacy ? decodeLegacyScore(item) : decodeScore(item)
          if (!score) continue
          const identity = JSON.stringify([categoryKey(score), score.car, score.difficulty, score.time, score.recordedAt])
          unique.set(identity, score)
        }
      }
      const scores = bestScores([...unique.values()])
      if (scores.length) merged.set(trackId, scores)
    }
    const records = Object.fromEntries(merged)
    // Keep serving the old records if storage is full; a later access retries.
    // Source keys are intentionally never removed.
    if (Object.keys(previous).length || Object.keys(oldest).length) {
      if (!this.write(records)) console.warn('Track Forge: score migration not yet persisted.')
    }
    return records
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
}
