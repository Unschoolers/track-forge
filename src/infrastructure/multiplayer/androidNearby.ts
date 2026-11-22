import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { NearbyEvent, NearbyTransport } from '@/application/multiplayer/nearbyRace'

type NativeEvent = Exclude<NearbyEvent, { type: 'packet' }> | { type: 'packet'; id: string; data: string }

const plugin = registerPlugin<{
  addListener(name: 'nearbyEvent', listener: (event: NativeEvent) => void): Promise<PluginListenerHandle>
  host(options: { name: string }): Promise<void>
  scan(): Promise<void>
  connect(options: { id: string }): Promise<void>
  respond(options: { id: string; accepted: boolean }): Promise<void>
  lock(): Promise<void>
  send(options: { ids: string[]; data: string }): Promise<void>
  stop(): Promise<void>
  diagnostics(): Promise<Record<string, unknown>>
  deliveryQuality(): Promise<Record<string, unknown>>
}>('TrackNearby')

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

export function createAndroidNearby(): NearbyTransport | undefined {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('TrackNearby')) return undefined
  let nativeListener: Promise<PluginListenerHandle> | undefined
  return {
    subscribe(listener) {
      let subscribed = true
      nativeListener = plugin.addListener('nearbyEvent', (event) => {
        if (!subscribed) return
        if (event.type === 'packet') {
          const { id, data } = event
          listener({ type: 'packet', id, bytes: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) })
        } else listener(event)
      })
      return () => {
        subscribed = false
        void nativeListener?.then((handle) => handle.remove()).catch(() => undefined)
      }
    },
    async host(name) { await nativeListener; await plugin.host({ name }) },
    async scan() { await nativeListener; await plugin.scan() },
    connect: (id) => plugin.connect({ id }),
    respond: (id, accepted) => plugin.respond({ id, accepted }),
    lock: () => plugin.lock(),
    send: (ids, bytes) => plugin.send({ ids, data: toBase64(bytes) }),
    stop: () => plugin.stop(),
    diagnostics: () => plugin.diagnostics(),
    deliveryQuality: () => plugin.deliveryQuality(),
  }
}
