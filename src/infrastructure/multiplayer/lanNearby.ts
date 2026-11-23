import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { NearbyEvent, NearbyTransport } from '@/application/multiplayer/nearbyRace'

interface LanNativeEvent {
  type: string
  id: string
  name?: string
  message?: string
  reason?: string
  data?: string
}

interface LanApi {
  host(options: { name: string }): Promise<{ hostIp?: string }>
  connectDirect(options: { ip: string }): Promise<void>
  scan(): Promise<void>
  connect(options: { id: string }): Promise<void>
  respond(options: { id: string; accepted: boolean }): Promise<void>
  lock(): Promise<void>
  send(options: { ids: string[]; data: string }): Promise<void>
  stop(): Promise<void>
  diagnostics(): Promise<Record<string, unknown>>
}

interface TauriGlobal {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> }
  event: {
    listen<T>(name: string, listener: (event: { payload: T }) => void): Promise<() => void>
  }
}

const androidLan = registerPlugin<LanApi & {
  addListener(name: 'lanEvent', listener: (event: LanNativeEvent) => void): Promise<PluginListenerHandle>
}>('TrackLan')

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function parseEvent(value: unknown): NearbyEvent {
  if (typeof value !== 'object' || value === null ||
      !('id' in value) || typeof value.id !== 'string' ||
      !('type' in value) || typeof value.type !== 'string') {
    return { type: 'error', message: 'Malformed LAN event' }
  }
  const event = value as LanNativeEvent
  if (event.type === 'packet') {
    if (typeof event.data !== 'string' || event.data.length > 24_000) {
      return { type: 'error', message: 'Malformed LAN packet' }
    }
    try {
      const bytes = Uint8Array.from(atob(event.data), char => char.charCodeAt(0))
      if (!bytes.length || bytes.length > 16_003) throw new Error('LAN packet exceeds limit')
      return { type: 'packet', id: event.id, bytes }
    } catch {
      return { type: 'error', message: 'Malformed LAN packet' }
    }
  }
  if (event.type === 'found' && typeof event.name === 'string') {
    return { type: 'found', id: event.id, name: event.name }
  }
  if (event.type === 'disconnected') {
    // Native reasons are bounded codes, never arbitrary socket messages or endpoint IDs.
    const reason = event.reason
    const known = typeof reason === 'string' && /^(remote_eof|remote_reject|invalid_frame_length|invalid_json|data_before_pairing|missing_data|invalid_base64|invalid_data_length|unsupported_frame|[A-Za-z]+Exception|socket_[A-Za-z]+_-?\d{1,10})$/.test(reason)
    return known ? { type: 'disconnected', id: event.id, reason } : { type: 'disconnected', id: event.id }
  }
  if (event.type === 'lost' || event.type === 'pairing' ||
      event.type === 'connected') {
    return { type: event.type, id: event.id }
  }
  return { type: 'error', id: event.id, message: event.message ?? 'Unexpected LAN transport event' }
}

function androidTransport(): NearbyTransport | undefined {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('TrackLan')) return undefined
  let subscription: Promise<PluginListenerHandle> | undefined
  let hostIp: string | null = null
  return {
    subscribe(listener) {
      let active = true
      subscription = androidLan.addListener('lanEvent', event => {
        if (active) listener(parseEvent(event))
      })
      void subscription.catch(error => listener({ type: 'error', message: `LAN event subscription failed: ${String(error)}` }))
      return () => {
        active = false
        void subscription?.then(handle => handle.remove()).catch(error =>
          console.error('Could not remove LAN event listener', error))
      }
    },
    async host(name) { await subscription; hostIp = (await androidLan.host({ name })).hostIp ?? null },
    async scan() { await subscription; hostIp = null; await androidLan.scan() },
    connect: id => androidLan.connect({ id }),
    connectDirect: ip => androidLan.connectDirect({ ip }),
    hostAddress: () => hostIp,
    respond: (id, accepted) => androidLan.respond({ id, accepted }),
    lock: () => androidLan.lock(),
    send: (ids, bytes) => androidLan.send({ ids, data: encode(bytes) }),
    async stop() { hostIp = null; await androidLan.stop() },
    diagnostics: () => androidLan.diagnostics(),
  }
}

function windowsTransport(): NearbyTransport | undefined {
  const api = (window as Window & { __TAURI__?: TauriGlobal }).__TAURI__
  if (!api?.core?.invoke || !api.event?.listen) return undefined
  let subscription: Promise<() => void> | undefined
  let hostIp: string | null = null
  const invoke = <T>(command: string, args?: Record<string, unknown>) => api.core.invoke<T>(command, args)
  return {
    subscribe(listener) {
      let active = true
      subscription = api.event.listen('trackforge-lan', event => {
        if (active) listener(parseEvent(event.payload))
      })
      void subscription.catch(error => listener({ type: 'error', message: `LAN event subscription failed: ${String(error)}` }))
      return () => {
        active = false
        void subscription?.then(unlisten => unlisten()).catch(error =>
          console.error('Could not remove LAN event listener', error))
      }
    },
    async host(name) {
      await subscription
      hostIp = await invoke<string | null>('lan_host', { name })
    },
    async scan() { await subscription; hostIp = null; await invoke('lan_scan') },
    connect: id => invoke('lan_connect', { id }),
    connectDirect: ip => invoke('lan_connect_direct', { ip }),
    hostAddress: () => hostIp,
    respond: (id, accepted) => invoke('lan_respond', { id, accepted }),
    lock: () => invoke('lan_lock'),
    send: (ids, bytes) => invoke('lan_send', { ids, data: encode(bytes) }),
    async stop() { hostIp = null; await invoke('lan_stop') },
    diagnostics: () => invoke('lan_diagnostics'),
  }
}

/** Both native platforms share a bounded LAN wire protocol; browsers cannot bind UDP/TCP ports. */
export function createLanNearby(): NearbyTransport | undefined {
  return Capacitor.getPlatform() === 'android' ? androidTransport() : windowsTransport()
}
