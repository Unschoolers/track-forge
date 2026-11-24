import type { KeyValueStore } from '@/application/ports/storage'
import type { Track } from '@/domain/model'
import {
  ghostRaceKey,
  MAX_GHOST_FRAMES,
  type GhostAvailability,
  type GhostFrame,
  type GhostRun,
  type GhostSetup,
  type GhostStore,
} from '@/application/race/ghostReplay'

const STORAGE_KEY = 'trackforge-ghost-runs-v2'
const LEGACY_STORAGE_KEY = 'trackforge-ghost-runs-v1'
const MAX_RUNS = 20

function validRun(value: unknown): value is GhostRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Partial<GhostRun>
  return (
    ['blue', 'red', 'green', 'yellow'].includes(run.car ?? '') &&
    Number.isFinite(run.time) && (run.time ?? 0) > 0 &&
    Array.isArray(run.frames) && run.frames.length >= 2 &&
    run.frames.length <= MAX_GHOST_FRAMES &&
    run.frames[0]?.t === 0 && run.frames.at(-1)?.t === run.time &&
    (run.splits === undefined || (Array.isArray(run.splits) && run.splits.length > 0 &&
      run.splits.every((time, index, splits) =>
        Number.isFinite(time) && time > 0 && time <= (run.time ?? 0) &&
        (index === 0 || time >= splits[index - 1])))) &&
    run.frames.every((frame, index, frames) =>
      frame && [frame.t, frame.x, frame.y, frame.angle, frame.z].every(Number.isFinite) &&
      frame.t >= 0 && frame.t <= run.time! &&
      (index === 0 || frame.t > frames[index - 1].t) &&
      (frame.cut === undefined || typeof frame.cut === 'boolean') &&
      (frame.structureRunId === null || typeof frame.structureRunId === 'string'))
  )
}

/** Best ghost for each exact car, track revision, direction and laps. */
export class BrowserGhostRepository implements GhostStore {
  constructor(private readonly storage: KeyValueStore) {}

  private readBank(key: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(this.storage.get(key) ?? '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {}
    } catch { return {} }
  }

  private write(runs: Record<string, GhostRun>): boolean {
    return this.storage.set(STORAGE_KEY, JSON.stringify({ version: 2, runs }))
  }

  private all(): { runs: Record<string, GhostRun>; migrationPending: boolean } {
    const current = this.readBank(STORAGE_KEY)
    if (current.version === 2 && current.runs && typeof current.runs === 'object' &&
        !Array.isArray(current.runs)) {
      return { runs: Object.fromEntries(Object.entries(current.runs).filter(([, run]) => validRun(run))), migrationPending: false }
    }

    const legacy = this.readBank(LEGACY_STORAGE_KEY)
    const merged = new Map<string, GhostRun>()
    for (const [key, run] of Object.entries(legacy)) {
      // Remove only the terminal Arcade ruleset component. Track IDs, revision,
      // direction and point-to-point prefix must be preserved verbatim.
      if (!validRun(run) || !key.endsWith('|arcade')) continue
      const newKey = key.slice(0, -'|arcade'.length)
      const [lapsText, car, direction] = newKey.split('|').reverse()
      const laps = Number(lapsText)
      if (car !== run.car || !Number.isSafeInteger(laps) || laps < 1 ||
          String(laps) !== lapsText || (direction !== 'forward' && direction !== 'reverse')) continue
      merged.set(newKey, run)
    }
    for (const [key, run] of Object.entries(current)) {
      if (!validRun(run)) continue
      const previous = merged.get(key)
      if (!previous || run.time <= previous.time) {
        merged.delete(key)
        merged.set(key, run)
      }
    }
    const runs = Object.fromEntries(merged)
    // Preserve the complete migrated bank; do not evict ghosts to force
    // migration into a full storage quota. The original bank stays intact.
    const migrationPending = Object.keys(legacy).length > 0 && !this.write(runs)
    if (migrationPending) console.warn('Track Forge: ghost migration not yet persisted.')
    return { runs, migrationPending }
  }

  availability(track: Track, setup: GhostSetup): GhostAvailability {
    const key = ghostRaceKey(track, setup)
    const suffix = `|${setup.car}|${setup.laps}`
    const prefix = `${key.slice(0, -suffix.length)}|`
    let best: { setup: GhostSetup; differences: number; time: number } | undefined
    for (const [candidateKey, run] of Object.entries(this.all().runs)) {
      if (!candidateKey.startsWith(prefix)) continue
      const parts = candidateKey.slice(prefix.length).split('|')
      const [car, lapsText] = parts
      const laps = Number(lapsText)
      if (parts.length !== 2 || !['blue', 'red', 'green', 'yellow'].includes(car ?? '') ||
          car !== run.car || !Number.isSafeInteger(laps) || laps < 1 || String(laps) !== lapsText) continue
      const candidate: GhostSetup = { car: run.car, laps }
      const differences = Number(candidate.car !== setup.car) + Number(laps !== setup.laps)
      if (differences === 0) return { kind: 'exact', time: run.time }
      if (!best || differences < best.differences || (differences === best.differences && run.time < best.time)) {
        best = { setup: candidate, differences, time: run.time }
      }
    }
    return best ? { kind: 'different-setup', setup: best.setup } : { kind: 'none' }
  }

  load(track: Track, setup: GhostSetup): GhostRun | null {
    return this.all().runs[ghostRaceKey(track, setup)] ?? null
  }

  record(track: Track, setup: GhostSetup, time: number, frames: readonly GhostFrame[], splits?: readonly number[]): boolean {
    const run = { car: setup.car, time, frames, ...(splits ? { splits } : {}) }
    if (!validRun(run)) return false
    const { runs: all, migrationPending } = this.all()
    const previousCount = Object.keys(all).length
    const key = ghostRaceKey(track, setup)
    if (all[key] && all[key].time <= time) return false
    delete all[key]
    all[key] = run
    // During migration never trade an existing ghost for a successful write.
    if (migrationPending) return this.write(all)
    const recent = Object.entries(all).slice(-Math.max(MAX_RUNS, previousCount))
    // Keep the new best, evicting older combinations if this device is full.
    while (recent.length > 0) {
      try {
        if (this.write(Object.fromEntries(recent))) return true
      } catch { /* Retry a smaller replay bank. */ }
      recent.shift()
    }
    return false
  }
}
