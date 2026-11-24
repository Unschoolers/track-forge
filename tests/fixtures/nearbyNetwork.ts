import type { NearbyEvent, NearbyTransport } from '@/application/multiplayer/nearbyRace'

export class NearbyNetwork {
  readonly packets: { from: string; to: string[]; bytes: Uint8Array }[] = []
  private readonly rooms = new Map<string, string>()
  private readonly listeners = new Map<string, (event: NearbyEvent) => void>()
  private readonly pairs = new Map<string, Set<string>>()
  private readonly connections = new Map<string, Set<string>>()

  constructor(private readonly rewritePacket?: (sender: string, recipient: string, bytes: Uint8Array) => Uint8Array,
    private readonly beforeSend?: (sender: string, recipient: string, bytes: Uint8Array) => Promise<void>) {}

  endpoint(id: string): NearbyTransport {
    return {
      subscribe: (listener) => {
        this.listeners.set(id, listener)
        return () => this.listeners.delete(id)
      },
      host: async (name) => { this.rooms.set(id, name) },
      scan: async () => {
        for (const [host, name] of this.rooms) this.emit(id, { type: 'found', id: host, name })
      },
      connect: async (host) => {
        const pairing = this.key(id, host)
        this.pairs.set(pairing, new Set())
        this.emit(id, { type: 'pairing', id: host })
        this.emit(host, { type: 'pairing', id })
      },
      respond: async (remote, yes) => {
        const key = this.key(id, remote)
        const pair = this.pairs.get(key)
        if (!pair) throw new Error('Unknown pairing')
        if (!yes) {
          this.pairs.delete(key)
          this.emit(remote, { type: 'error', id, message: 'Pairing declined' })
          return
        }
        pair.add(id)
        if (pair.size !== 2) return
        this.pairs.delete(key)
        this.connect(id, remote)
        this.connect(remote, id)
        this.emit(id, { type: 'connected', id: remote })
        this.emit(remote, { type: 'connected', id })
      },
      lock: async () => { this.rooms.delete(id) },
      send: async (ids, bytes) => {
        this.packets.push({ from: id, to: [...ids], bytes })
        for (const remote of ids) {
          if (this.beforeSend) await this.beforeSend(id, remote, bytes)
          if (!this.connections.get(id)?.has(remote)) throw new Error('Unknown connection')
          const delivered = this.rewritePacket?.(id, remote, bytes) ?? bytes
          this.emit(remote, { type: 'packet', id, bytes: new Uint8Array(delivered) })
        }
      },
      stop: async () => {
        this.rooms.delete(id)
        for (const remote of this.connections.get(id) ?? []) {
          this.connections.get(remote)?.delete(id)
          this.emit(remote, { type: 'disconnected', id })
        }
        this.connections.delete(id)
      },
    }
  }

  private connect(id: string, remote: string): void {
    const connections = this.connections.get(id) ?? new Set()
    connections.add(remote)
    this.connections.set(id, connections)
  }

  private key(left: string, right: string) { return [left, right].sort().join('|') }
  private emit(id: string, event: NearbyEvent): void {
    queueMicrotask(() => this.listeners.get(id)?.(event))
  }
}
