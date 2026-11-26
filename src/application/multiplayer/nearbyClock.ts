/** NTP-style exchange over independent monotonic clocks. No wall-clock dependency. */
export const CLOCK_PROBE_COUNT = 5
export const CLOCK_PROBE_MASK = 0xffff
const MIN_STAGING_SAMPLES = 3
export type ClockEstimate = { readonly offsetMs: number; readonly roundTripMs: number }

export class NearbyClock {
  private samples: ClockEstimate[] = []
  private pending: { probe: number; sentAt: number } | null = null

  private nextProbe: number

  constructor(private readonly firstProbe = 0) { this.nextProbe = firstProbe }

  reset(): void { this.restart(); this.nextProbe = this.firstProbe }

  /** Preserve probe IDs between audit windows so late replies cannot match. */
  restart(): void { this.samples = []; this.pending = null }

  request(now: number) {
    if (this.pending || this.samples.length >= CLOCK_PROBE_COUNT || this.stagingProbesExhausted) return null
    this.pending = { probe: this.nextProbe, sentAt: now }
    this.nextProbe = (this.nextProbe + 1) & CLOCK_PROBE_MASK
    return { ...this.pending }
  }

  expire(probe: number): boolean {
    if (this.pending?.probe !== probe) return false
    this.pending = null
    return true
  }

  private get stagingProbesExhausted(): boolean {
    // Wire v6 reserves IDs 0–4 for staging and the remaining IDs for audits.
    return this.firstProbe === 0 && this.nextProbe >= CLOCK_PROBE_COUNT
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
    const minimum = this.stagingProbesExhausted && !this.pending ? MIN_STAGING_SAMPLES : CLOCK_PROBE_COUNT
    if (this.samples.length < minimum) return null
    // Prefer the fastest exchange: queueing only increases the uncertainty.
    return [...this.samples].sort((a, b) => a.roundTripMs - b.roundTripMs)[0] ?? null
  }
}
