import { decodeProgress, encodeProgress, isNewerWireSequence, PROGRESS_PERIOD_MS, WIRE_ROUND_MASK, type ProgressPacket } from './raceWire'

/** Low-rate progress stream for host-authoritative standings and diagnostics. */
export class NearbyProgressSync {
  private readonly remote = new Map<number, { sequence: number; value: number; at: number }>()
  private readonly relayed = new Map<number, number>()
  private round = 0
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
    this.round = 0
    this.nextSequence = 0
    this.lastSentAt = Number.NEGATIVE_INFINITY
  }

  setRound(round: number): void { this.round = round & WIRE_ROUND_MASK }

  update(slot: number, value: number, recipients: string[]): void {
    const now = this.now()
    if (!recipients.length || this.inFlight.has(slot) || now - this.lastSentAt < PROGRESS_PERIOD_MS) return
    const packet = encodeProgress(slot, this.nextSequence, value, this.round)
    this.nextSequence = (this.nextSequence + 1) & 0xffff
    this.lastSentAt = now
    this.dispatch(slot, packet, recipients)
  }

  /** One host relay per progress source, addressed to every eligible guest. */
  relay(packet: Uint8Array, recipients: string[]): void {
    const message = decodeProgress(packet)
    if (!message || message.round !== this.round || !recipients.length || this.inFlight.has(message.slot) ||
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
    // Settle ordering and in-flight state together. A separate catch/finally
    // chain leaves an already delivered slot blocked for extra microtasks.
    void this.send(recipients, packet).then(
      () => {
        if (active !== this.generation) return
        this.inFlight.delete(slot)
        onSent?.()
      },
      () => {
        if (active !== this.generation) return
        this.sendFailures++
        this.inFlight.delete(slot)
      },
    )
  }

  receive(packet: ProgressPacket): boolean {
    if (packet.round !== this.round) return false
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
