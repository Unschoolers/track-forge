import type { Track } from '@/domain/model'
import { encodeControl } from './controlProtocol'
import { packTrack } from './trackTransfer'

type ShareStatus = 'saved' | 'declined'

/** Room-scoped share bookkeeping and transfer. NearbyRace owns phases and peers. */
export class NearbyTrackShare {
  private incomingTrack: Track | null = null
  private result: ShareStatus | null = null
  private readonly savedPeers = new Set<string>()
  private readonly ready = new Set<string>()
  private readonly sent = new Set<string>()
  private packed: Promise<Uint8Array[]> | null = null

  get incoming(): Track | null { return this.incomingTrack }
  get status(): ShareStatus | null { return this.result }
  get sharedCount(): number { return this.savedPeers.size }

  receive(track: Track): void {
    this.incomingTrack = track
    this.result = null
  }

  respond(saved: boolean): ShareStatus {
    this.incomingTrack = null
    this.result = saved ? 'saved' : 'declined'
    return this.result
  }

  markReady(id: string): void { this.ready.add(id) }
  isReady(id: string): boolean { return this.ready.has(id) }
  markSaved(id: string): void { this.savedPeers.add(id) }

  disconnect(id: string): void {
    this.ready.delete(id)
    this.sent.delete(id)
  }

  reset(): void {
    this.incomingTrack = null
    this.savedPeers.clear()
    this.ready.clear()
    this.sent.clear()
    this.result = null
    this.packed = null
  }

  async send(
    id: string,
    track: Track | undefined,
    active: () => boolean,
    send: (ids: string[], bytes: Uint8Array) => Promise<void>,
    onSent: (chunks: number) => void,
  ): Promise<void> {
    if (!track || this.sent.has(id)) return
    this.sent.add(id)
    try {
      if (!this.packed) this.packed = packTrack(track)
      const chunks = await this.packed
      if (!active()) return
      await send([id], encodeControl({ type: 'share-offer' }))
      for (const chunk of chunks) {
        if (!active()) return
        await send([id], chunk)
      }
      onSent(chunks.length)
    } catch (error) {
      this.sent.delete(id)
      throw error
    }
  }
}
