import { describe, expect, it, vi } from 'vitest'
import { NearbyRace, type NearbyEvent, type NearbyTransport } from '@/application/multiplayer/nearbyRace'
import { nearbyTrack as track } from '../fixtures/nearbyRace'

describe('LAN pairing disconnect regression', () => {
  it('keeps the host room open if a guest drops before its accept command finishes', async () => {
    let emit: (event: NearbyEvent) => void = () => {}
    let rejectAccept: ((reason: Error) => void) | undefined
    const respond = vi.fn((_id: string, _accept: boolean) => new Promise<void>((_resolve, reject) => {
      rejectAccept = reject
    }))
    const stop = vi.fn(async () => undefined)
    const transport: NearbyTransport = {
      subscribe: listener => { emit = listener; return () => {} },
      host: async () => undefined,
      scan: async () => undefined,
      connect: async () => undefined,
      respond,
      lock: async () => undefined,
      send: async () => undefined,
      stop,
    }
    const host = new NearbyRace(transport, () => true)
    try {
      host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'))
      emit({ type: 'pairing', id: 'guest-1' })
      await vi.waitFor(() => expect(respond).toHaveBeenCalledWith('guest-1', true))
      emit({ type: 'disconnected', id: 'guest-1' })
      rejectAccept?.(new Error('LAN player disconnected'))
      await vi.waitFor(async () => {
        const trace = await host.diagnostics()
        expect(trace.timeline).toEqual(expect.arrayContaining([
          expect.objectContaining({ event: 'pairing_peer_left', stage: 'during_accept' }),
        ]))
      })
      expect(host.snapshot().phase).toBe('hosting')
      expect(host.snapshot().players).toBe(1)
      expect(host.snapshot().error).toBeNull()
      expect(stop).not.toHaveBeenCalled()
    } finally {
      host.destroy()
    }
  })

  it('keeps a real host-side acceptance error visible while the peer is still pending', async () => {
    let emit: (event: NearbyEvent) => void = () => {}
    const transport: NearbyTransport = {
      subscribe: listener => { emit = listener; return () => {} },
      host: async () => undefined, scan: async () => undefined,
      connect: async () => undefined,
      respond: async () => { throw new Error('Transport unavailable') },
      lock: async () => undefined, send: async () => undefined,
      stop: async () => undefined,
    }
    const host = new NearbyRace(transport, () => true)
    try {
      host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'))
      emit({ type: 'pairing', id: 'guest-1' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('idle'))
      expect(host.snapshot().error).toContain('Transport unavailable')
    } finally {
      host.destroy()
    }
  })
})
