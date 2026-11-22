/**
 * Fixed-size, allocation-free-on-receive Nearby telemetry.
 * Sequence jumps show missing samples, not necessarily radio packet loss:
 * the sender may intentionally skip old frames when a peer is congested.
 */
const GAP_BOUNDS_MS = [34, 50, 100, 150, 250, 500, 1000, 2000] as const
const POSE_EXPIRY_MS = 2000

class StreamStats {
  private accepted = 0
  private rejected = 0
  private lastSequence: number | undefined
  private lastAt: number | undefined
  private firstAt: number | undefined
  private totalGapMs = 0
  private maxGapMs = 0
  private sequenceJumps = 0
  private skippedSamples = 0
  private readonly gaps = new Uint32Array(GAP_BOUNDS_MS.length + 1)

  record(sequence: number, accepted: boolean, at: number): void {
    if (!accepted) { this.rejected++; return }
    this.accepted++
    if (this.lastSequence !== undefined) {
      const advance = (sequence - this.lastSequence) & 0xffff
      if (advance > 1 && advance < 0x8000) {
        this.sequenceJumps++
        this.skippedSamples += advance - 1
      }
    }
    if (this.lastAt === undefined) this.firstAt = at
    else {
      const gap = Math.max(0, at - this.lastAt)
      this.totalGapMs += gap
      this.maxGapMs = Math.max(this.maxGapMs, gap)
      let bucket = 0
      while (bucket < GAP_BOUNDS_MS.length && gap > GAP_BOUNDS_MS[bucket]!) bucket++
      this.gaps[bucket]!++
    }
    this.lastAt = at
    this.lastSequence = sequence
  }

  snapshot(now: number, origin: number, expiryMs: number) {
    const gaps = Math.max(0, this.accepted - 1)
    const silenceMs = this.lastAt === undefined ? null : Math.round(Math.max(0, now - this.lastAt))
    const percentileUpperBound = (fraction: number): number | null => {
      if (!gaps) return null
      const rank = Math.ceil(gaps * fraction)
      let count = 0
      for (let index = 0; index < this.gaps.length; index++) {
        count += this.gaps[index]!
        if (count >= rank) return index < GAP_BOUNDS_MS.length ? GAP_BOUNDS_MS[index]! : Math.ceil(this.maxGapMs)
      }
      return null
    }
    return {
      accepted: this.accepted, rejectedStaleOrDuplicate: this.rejected,
      sequenceJumps: this.sequenceJumps, skippedSamples: this.skippedSamples,
      firstAtMs: this.firstAt === undefined ? null : Math.round(this.firstAt - origin),
      lastAtMs: this.lastAt === undefined ? null : Math.round(this.lastAt - origin),
      lastSequence: this.lastSequence ?? null, silenceMs,
      expired: silenceMs !== null && silenceMs > expiryMs,
      meanGapMs: gaps ? Math.round(this.totalGapMs / gaps) : null,
      maxGapMs: gaps ? Math.round(this.maxGapMs) : null,
      p95GapUpperBoundMs: percentileUpperBound(0.95),
      gapsOver250Ms: this.gaps.slice(5).reduce((sum, count) => sum + count, 0),
      gapsOver500Ms: this.gaps.slice(6).reduce((sum, count) => sum + count, 0),
      gapsOver2000Ms: this.gaps[8],
    }
  }
}

/** Collect only counters/timestamps on receive; allocate detailed JSON on explicit export. */
export class NearbyNetworkTelemetry {
  private readonly poses = Array.from({ length: 4 }, () => new StreamStats())
  private readonly progress = Array.from({ length: 4 }, () => new StreamStats())

  recordPose(slot: number, sequence: number, accepted: boolean, at: number): void {
    this.poses[slot]?.record(sequence, accepted, at)
  }

  recordProgress(slot: number, sequence: number, accepted: boolean, at: number): void {
    this.progress[slot]?.record(sequence, accepted, at)
  }

  snapshot(now: number, origin: number) {
    return this.poses.map((pose, slot) => ({
      slot,
      pose: pose.snapshot(now, origin, POSE_EXPIRY_MS),
      progress: this.progress[slot]!.snapshot(now, origin, 1500),
    }))
  }
}
