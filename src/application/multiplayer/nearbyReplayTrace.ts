import type { CarId } from '@/domain/model'

export interface NearbyTraceLocal {
  readonly slot: number
  readonly car: CarId
  readonly x: number
  readonly y: number
  readonly z: number
  readonly angle: number
  readonly lap: number
  readonly sector: number
  readonly pathIndex: number
  readonly speed: number
}

export type NearbyTraceRival =
  | { readonly slot: number; readonly car: CarId; readonly visible: false }
  | { readonly slot: number; readonly car: CarId; readonly visible: true;
      readonly x: number; readonly y: number; readonly z: number; readonly angle: number;
      readonly observedAtMs: number; readonly progress: number | null }

export interface NearbyTraceFrame {
  /** The local race clock, not synchronized wall time across devices. */
  readonly elapsed: number
  readonly local: NearbyTraceLocal
  readonly rivals: readonly NearbyTraceRival[]
  readonly missedGate?: number | undefined
}

/** Bounded observation trace for diagnosing disappearing rivals, not a deterministic simulation replay. */
export class NearbyReplayTrace {
  private frames: NearbyTraceFrame[] = []
  private nextIndex = 0
  private skippedOldest = 0
  private lastSampleAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly limit = 2400,
    private readonly intervalMs = 125,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 ||
        !Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError('Invalid Nearby trace sampling limits.')
    }
  }

  record(atMs: number, frame: NearbyTraceFrame, force = false): void {
    if (!Number.isFinite(atMs) ||
        (!force && atMs - this.lastSampleAt < this.intervalMs)) return
    this.lastSampleAt = atMs
    if (this.frames.length < this.limit) this.frames.push(frame)
    else {
      this.frames[this.nextIndex] = frame
      this.nextIndex = (this.nextIndex + 1) % this.limit
      this.skippedOldest++
    }
  }

  reset(): void {
    this.frames = []
    this.nextIndex = 0
    this.skippedOldest = 0
    this.lastSampleAt = Number.NEGATIVE_INFINITY
  }

  snapshot(): { intervalMs: number; limit: number; truncated: number; frames: readonly NearbyTraceFrame[] } {
    return {
      intervalMs: this.intervalMs,
      limit: this.limit,
      truncated: this.skippedOldest,
      frames: this.skippedOldest
        ? [...this.frames.slice(this.nextIndex), ...this.frames.slice(0, this.nextIndex)]
        : [...this.frames],
    }
  }
}
