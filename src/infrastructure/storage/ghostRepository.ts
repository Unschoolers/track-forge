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
    run.frames[0]?.t === 0 && run.frames.at(-1)?.t === run.time &&
    (run.splits === undefined || (Array.isArray(run.splits) && run.splits.length > 0 &&
      run.splits.length % 4 === 0 && run.splits.every((time, index, splits) =>
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

  availability(track: Track, setup: GhostSetup): GhostAvailability {
    const key = ghostRaceKey(track, setup)
    const suffix = `|${setup.car}|${setup.laps}|${setup.handling ?? 'arcade'}`
    const prefix = key.slice(0, -suffix.length) + '|'
    let best: { setup: GhostSetup; differences: number; time: number } | undefined
    for (const [candidateKey, run] of Object.entries(this.all()).slice(-MAX_RUNS)) {
      if (!candidateKey.startsWith(prefix)) continue
      const parts = candidateKey.slice(prefix.length).split('|')
      const [car, lapsText, handling] = parts
      const laps = Number(lapsText)
      if (parts.length !== 3 || !['blue', 'red', 'green', 'yellow'].includes(car ?? '') ||
          car !== run.car || !Number.isSafeInteger(laps) || laps < 1 || String(laps) !== lapsText ||
          (handling !== 'arcade' && handling !== 'simulation')) continue
      const candidate: GhostSetup = { car: run.car, laps, handling }
      const differences = Number(candidate.car !== setup.car) + Number(laps !== setup.laps) +
        Number(handling !== (setup.handling ?? 'arcade'))
      if (differences === 0) return { kind: 'exact', time: run.time }
      if (!best || differences < best.differences || (differences === best.differences && run.time < best.time)) {
        best = { setup: candidate, differences, time: run.time }
      }
    }
    return best ? { kind: 'different-setup', setup: best.setup } : { kind: 'none' }
  }

  load(track: Track, setup: GhostSetup): GhostRun | null {
    return this.all()[ghostRaceKey(track, setup)] ?? null
  }

  record(track: Track, setup: GhostSetup, time: number, frames: readonly GhostFrame[], splits?: readonly number[]): boolean {
    const run = { car: setup.car, time, frames, ...(splits ? { splits } : {}) }
    if (!validRun(run)) return false
    const all = this.all()
    const key = ghostRaceKey(track, setup)
    if (all[key] && all[key].time <= time) return false
    delete all[key]
    all[key] = run
    const recent = Object.entries(all).slice(-MAX_RUNS)
    // Keep the new best, evicting older combinations if this device is full.
    while (recent.length > 0) {
      try {
        if (this.storage.set(STORAGE_KEY, JSON.stringify(Object.fromEntries(recent)))) return true
      } catch { /* Retry a smaller replay bank. */ }
      recent.shift()
    }
    return false
  }
}
