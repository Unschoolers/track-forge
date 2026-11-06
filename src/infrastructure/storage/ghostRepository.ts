import type { KeyValueStore } from '@/application/ports/storage'
import type { Track } from '@/domain/model'
import {
  ghostRaceKey,
  MAX_GHOST_FRAMES,
  type GhostFrame,
  type GhostRun,
  type GhostSetup,
  type GhostStore,
} from '@/application/race/ghostReplay'

const STORAGE_KEY = 'trackforge-ghost-runs-v1'
const MAX_RUNS = 20

function validRun(value: unknown): value is GhostRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Partial<GhostRun>
  return (
    ['blue', 'red', 'green', 'yellow'].includes(run.car ?? '') &&
    Number.isFinite(run.time) && (run.time ?? 0) > 0 &&
    Array.isArray(run.frames) && run.frames.length >= 2 &&
    run.frames.length <= MAX_GHOST_FRAMES &&
    run.frames.every((frame) =>
      frame && [frame.t, frame.x, frame.y, frame.angle, frame.z].every(Number.isFinite) &&
      (frame.structureRunId === null || typeof frame.structureRunId === 'string'))
  )
}

/** Best ghost for each exact car, track revision, direction, laps and handling. */
export class BrowserGhostRepository implements GhostStore {
  constructor(private readonly storage: KeyValueStore) {}

  private all(): Record<string, GhostRun> {
    try {
      const parsed: unknown = JSON.parse(this.storage.get(STORAGE_KEY) ?? '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      return Object.fromEntries(Object.entries(parsed).filter(([, run]) => validRun(run)))
    } catch { return {} }
  }

  load(track: Track, setup: GhostSetup): GhostRun | null {
    return this.all()[ghostRaceKey(track, setup)] ?? null
  }

  record(track: Track, setup: GhostSetup, time: number, frames: readonly GhostFrame[]): boolean {
    const run = { car: setup.car, time, frames }
    if (!validRun(run)) return false
    const all = this.all()
    const key = ghostRaceKey(track, setup)
    if (all[key] && all[key].time <= time) return false
    delete all[key]
    all[key] = run
    const recent = Object.entries(all).slice(-MAX_RUNS)
    try { return this.storage.set(STORAGE_KEY, JSON.stringify(Object.fromEntries(recent))) }
    catch { return false }
  }
}
