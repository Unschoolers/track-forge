interface RosterDelivery {
  readonly revision: number
  readonly send: (id: string) => Promise<void>
  readonly settled: () => void
  readonly failed: (error: unknown) => void
  readonly superseded: () => void
}

interface PeerDelivery {
  next: RosterDelivery | undefined
}

/** At most one reliable send and one latest queued snapshot per peer.
 * A newer full roster replaces intermediate revisions, but must itself succeed.
 * The host cannot commit the lineup until the current peer queues are empty.
 */
export class NearbyRosterDelivery {
  private readonly peers = new Map<string, PeerDelivery>()

  get pending(): boolean { return this.peers.size > 0 }

  reset(): void { this.peers.clear() }
  removePeer(id: string): void { this.peers.delete(id) }

  publish(ids: readonly string[], delivery: RosterDelivery): void {
    for (const id of ids) {
      const existing = this.peers.get(id)
      if (existing) {
        existing.next = delivery
      } else {
        const peer: PeerDelivery = { next: delivery }
        this.peers.set(id, peer)
        void this.drain(id, peer)
      }
    }
  }

  private async drain(id: string, peer: PeerDelivery): Promise<void> {
    while (this.peers.get(id) === peer && peer.next) {
      const delivery = peer.next
      peer.next = undefined
      try {
        await delivery.send(id)
      } catch (error: unknown) {
        if (this.peers.get(id) !== peer) return
        // A full newer snapshot can repair a failed old delivery. Do not
        // release the staging barrier until the replacement has succeeded.
        if (peer.next && (peer.next as RosterDelivery).revision > delivery.revision) {
          delivery.superseded()
          continue
        }
        this.peers.delete(id)
        delivery.failed(error)
        return
      }
      if (this.peers.get(id) !== peer) return
      if (!peer.next) {
        this.peers.delete(id)
        delivery.settled()
        return
      }
    }
  }
}
