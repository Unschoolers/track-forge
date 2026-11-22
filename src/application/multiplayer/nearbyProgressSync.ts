import { encodeProgress, PROGRESS_PERIOD_MS, type ProgressPacket } from './raceWire'

/** A low-rate optional stream; old peers ignore these packets and still render poses. */
export class NearbyProgressSync {
  private readonly remote = new Map<number, { sequence: number; value: number; at: number }>()
  private nextSequence = 0
  private lastSentAt = Number.NEGATIVE_INFINITY
  private sendFailures = 0
  private readonly inFlight = new Set<string>()
  private generation = 0

  constructor(
    private readonly send: (recipients: string[], bytes: Uint8Array) => Promise<void>,
    private readonly now: () => number,
  ) {}

  get failedSends(): number { return this.sendFailures }

  reset(): void {
    this.generation++
    this.inFlight.clear()
    this.sendFailures = 0
    this.remote.clear()
    this.nextSequence = 0
    this.lastSentAt = Number.NEGATIVE_INFINITY
  }

  update(slot: number, value: number, recipients: string[]): void {
    const now = this.now()
    if (now - this.lastSentAt < PROGRESS_PERIOD_MS) return
    const readyRecipients = recipients.filter(id => !this.inFlight.has(id))
    if (!readyRecipients.length) return
    const packet = encodeProgress(slot, this.nextSequence, value)
    this.nextSequence = (this.nextSequence + 1) & 0xffff
    this.lastSentAt = now
    this.dispatch(packet, readyRecipients)
  }

  /** Relayed standings are best-effort too; never queue old progress samples. */
  relay(packet: Uint8Array, recipients: string[]): void {
    this.dispatch(packet, recipients.filter(id => !this.inFlight.has(id)))
  }

  private dispatch(packet: Uint8Array, recipients: string[]): void {
    const active = this.generation
    for (const id of recipients) {
      this.inFlight.add(id)
      void this.send([id], packet)
        .catch(() => {
          if (active === this.generation) this.sendFailures++
        })
        .finally(() => {
          if (active === this.generation) this.inFlight.delete(id)
        })
    }
  }

  receive(packet: ProgressPacket): boolean {
    const previous = this.remote.get(packet.slot)
    if (previous) {
      const advance = (packet.sequence - previous.sequence) & 0xffff
      if (advance === 0 || advance >= 0x8000) return false
    }
    this.remote.set(packet.slot, { sequence: packet.sequence, value: packet.progress, at: this.now() })
    return true
  }

  latest(slot: number): number | null {
    const sample = this.remote.get(slot)
    return sample && this.now() - sample.at <= 1500 ? sample.value : null
  }
}
