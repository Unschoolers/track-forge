import type { NearbyEvent, NearbyTransport } from '@/application/multiplayer/nearbyRace'

export type ConnectionMode = 'android' | 'lan'

export interface NearbyConnectionChoice {
  readonly mode: ConnectionMode
  readonly label: string
  readonly description: string
}

export interface NearbyConnectionModes {
  readonly choices: readonly NearbyConnectionChoice[]
  current(): ConnectionMode
  choose(mode: ConnectionMode): boolean
}

/** A NearbyRace sees exactly one adapter per room; no cross-transport peer IDs leak into the protocol. */
export function selectNearbyConnection(android?: NearbyTransport, lan?: NearbyTransport):
  { transport?: NearbyTransport; modes?: NearbyConnectionModes } {
  const adapters = new Map<ConnectionMode, NearbyTransport>()
  if (android) adapters.set('android', android)
  if (lan) adapters.set('lan', lan)
  if (!adapters.size) return {}
  let mode: ConnectionMode = android ? 'android' : 'lan'
  let running = false
  let listener: ((event: NearbyEvent) => void) | undefined
  let unsubscribe: (() => void) | undefined

  function attach() {
    unsubscribe?.()
    const selectedMode = mode
    unsubscribe = adapters.get(mode)?.subscribe(event => {
      if (selectedMode === mode) listener?.(event)
    })
  }

  const transport: NearbyTransport = {
    subscribe(callback) {
      listener = callback
      attach()
      return () => {
        unsubscribe?.()
        unsubscribe = undefined
        listener = undefined
      }
    },
    async host(name) {
      running = true
      try { await adapters.get(mode)!.host(name) }
      catch (error) { running = false; throw error }
    },
    async scan() {
      running = true
      try { await adapters.get(mode)!.scan() }
      catch (error) { running = false; throw error }
    },
    connect: id => adapters.get(mode)!.connect(id),
    respond: (id, accepted) => adapters.get(mode)!.respond(id, accepted),
    lock: () => adapters.get(mode)!.lock(),
    send: (ids, bytes) => adapters.get(mode)!.send(ids, bytes),
    async stop() {
      try { await adapters.get(mode)!.stop() }
      finally { running = false }
    },
    diagnostics: () => adapters.get(mode)!.diagnostics?.() ?? Promise.resolve({ status: 'unavailable' }),
    deliveryQuality: () => adapters.get(mode)!.deliveryQuality?.() ?? Promise.resolve({ status: 'unavailable' }),
  }

  const choices: readonly NearbyConnectionChoice[] = [
    ...(android ? [{ mode: 'android' as const, label: 'ANDROID NEARBY', description: 'Nearby devices · Bluetooth / Wi-Fi Direct' }] : []),
    ...(lan ? [{ mode: 'lan' as const, label: 'LOCAL WI-FI', description: 'Windows + Android · Same Wi-Fi / LAN' }] : []),
  ]
  return {
    transport,
    modes: {
      choices,
      current: () => mode,
      choose(nextMode) {
        if (running || !adapters.has(nextMode)) return false
        if (mode !== nextMode) {
          mode = nextMode
          if (listener) attach()
        }
        return true
      },
    },
  }
}
