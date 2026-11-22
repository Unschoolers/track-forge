import { decodeProgress, encodeProgress, isNewerWireSequence, PROGRESS_PERIOD_MS, type ProgressPacket } from './raceWire'

/** A low-rate optional stream; old peers ignore these packets and still render poses. */
export class NearbyProgressSync {
  private readonly remote = new Map<number, { sequence: number; value: number; at: number }>()
  private readonly relayed = new Map<number, number>()
  private nextSequence = 0
  private lastSentAt = Number.NEGATIVE_INFINITY
  private sendFailures = 0
  private readonly inFlight = new Set<number>()
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
    this.relayed.clear()
    this.nextSequence = 0
    this.lastSentAt = Number.NEGATIVE_INFINITY
  }

  update(slot: number, value: number, recipients: string[]): void {
    const now = this.now()
    if (!recipients.length || this.inFlight.has(slot) || now - this.lastSentAt < PROGRESS_PERIOD_MS) return
    const packet = encodeProgress(slot, this.nextSequence, value)
    this.nextSequence = (this.nextSequence + 1) & 0xffff
    this.lastSentAt = now
    this.dispatch(slot, packet, recipients)
  }

  /** One host relay per progress source, addressed to every eligible guest. */
  relay(packet: Uint8Array, recipients: string[]): void {
    const message = decodeProgress(packet)
    if (!message || !recipients.length || this.inFlight.has(message.slot) ||
        !isNewerWireSequence(message.sequence, this.relayed.get(message.slot))) return
    // Mark a relay as delivered only on success; a transport failure can
    // safely retry the same packet instead of stranding remote progress.
    this.dispatch(message.slot, packet, recipients, () => {
      this.relayed.set(message.slot, message.sequence)
    })
  }

  private dispatch(slot: number, packet: Uint8Array, recipients: string[], onSent?: () => void): void {
    const active = this.generation
    this.inFlight.add(slot)
    void this.send(recipients, packet)
      .then(() => {
        if (active === this.generation) onSent?.()
      })
      .catch(() => {
        if (active === this.generation) this.sendFailures++
      })
      .finally(() => {
        if (active === this.generation) this.inFlight.delete(slot)
      })
  }

  receive(packet: ProgressPacket): boolean {
    const previous = this.remote.get(packet.slot)
    if (!isNewerWireSequence(packet.sequence, previous?.sequence)) return false
    this.remote.set(packet.slot, { sequence: packet.sequence, value: packet.progress, at: this.now() })
    return true
  }

  latest(slot: number): number | null {
    const sample = this.remote.get(slot)
    return sample && this.now() - sample.at <= 1500 ? sample.value : null
  }
}
