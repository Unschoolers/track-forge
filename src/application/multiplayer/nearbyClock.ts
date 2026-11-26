/** NTP-style exchange over independent monotonic clocks. No wall-clock dependency. */
export const CLOCK_PROBE_COUNT = 5

export class NearbyClock {
  private samples: { offsetMs: number; roundTripMs: number }[] = []
  private pending: { probe: number; sentAt: number } | null = null

  reset(): void { this.samples = []; this.pending = null }

  request(now: number) {
    if (this.pending || this.samples.length >= CLOCK_PROBE_COUNT) return null
    this.pending = { probe: this.samples.length, sentAt: now }
    return { ...this.pending }
  }

  receive(probe: number, hostReceivedAt: number, hostSentAt: number, now: number): boolean {
    const pending = this.pending
    if (!pending || pending.probe !== probe) return false
    const roundTripMs = now - pending.sentAt - (hostSentAt - hostReceivedAt)
    if (!Number.isFinite(roundTripMs) || roundTripMs < -1 || roundTripMs > 5000 ||
        hostSentAt < hostReceivedAt || now < pending.sentAt) return false
    const offsetMs = ((hostReceivedAt - pending.sentAt) + (hostSentAt - now)) / 2
    if (!Number.isFinite(offsetMs)) return false
    this.samples.push({ offsetMs, roundTripMs: Math.max(0, roundTripMs) })
    this.pending = null
    return true
  }

  get estimate() {
    if (this.samples.length < CLOCK_PROBE_COUNT) return null
    // Prefer the fastest exchange: queueing only increases the uncertainty.
    return [...this.samples].sort((a, b) => a.roundTripMs - b.roundTripMs)[0] ?? null
  }
}
