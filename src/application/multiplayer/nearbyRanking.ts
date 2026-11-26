import { isNewerWireSequence } from './raceWire'

export interface RankEntry {
  readonly slot: number
  readonly progress: number | null
  readonly finish: number | null | undefined
  readonly left: boolean
}

/** Host only. An incomplete active field has no official ranking. */
export function rankNearby(entries: readonly RankEntry[]): number[] {
  if (entries.some(entry => !entry.left && entry.finish === undefined && entry.progress === null)) return []
  const status = (entry: RankEntry) => typeof entry.finish === 'number' ? 0 :
    entry.left || entry.finish === null ? 2 : 1
  return [...entries].sort((a, b) => status(a) - status(b) ||
    (status(a) === 0 ? (a.finish ?? 0) - (b.finish ?? 0) :
      status(a) === 1 ? (b.progress ?? 0) - (a.progress ?? 0) : 0) || a.slot - b.slot)
    .map(entry => entry.slot)
}

export class NearbyRanking {
  private order: number[] = []
  private sequence: number | undefined
  private at = -Infinity
  private inFlight = false
  private generation = 0
  private sentAt = -Infinity

  reset(): void {
    this.generation++
    this.order = []; this.sequence = undefined; this.at = -Infinity
    this.inFlight = false; this.sentAt = -Infinity
  }

  publish(order: number[], now: number, send: (sequence: number, order: number[]) => Promise<void>, failed: () => void): void {
    if (this.inFlight || (now - this.sentAt < 500 && order.join(',') === this.order.join(','))) return
    // At most one reliable ranking update in flight. A later tick replaces the
    // pending intent; no backlog of obsolete standings.
    const sequence = ((this.sequence ?? -1) + 1) & 0xffff
    const active = this.generation
    this.inFlight = true
    this.sentAt = now
    this.receive(sequence, order, now)
    void send(sequence, order).then(() => {
      if (active === this.generation) this.inFlight = false
    }, () => {
      if (active !== this.generation) return
      this.inFlight = false
      this.sentAt = -Infinity
      failed()
    })
  }

  receive(sequence: number, order: readonly number[], now: number): boolean {
    if (!isNewerWireSequence(sequence, this.sequence)) return false
    this.sequence = sequence; this.order = [...order]; this.at = now
    return true
  }

  position(slot: number, now: number): { position: number; vehicleCount: number } | null {
    const index = this.order.indexOf(slot)
    return index >= 0 && now - this.at <= 1500
      ? { position: index + 1, vehicleCount: this.order.length } : null
  }

  diagnostics() { return { sequence: this.sequence ?? null, order: [...this.order], atMs: Number.isFinite(this.at) ? this.at : null } }
}
