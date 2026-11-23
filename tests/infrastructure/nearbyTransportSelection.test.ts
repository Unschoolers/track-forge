import { describe, expect, it, vi } from 'vitest'
import { selectNearbyConnection } from '@/infrastructure/multiplayer/selectNearbyConnection'
import type { NearbyEvent, NearbyTransport } from '@/application/multiplayer/nearbyRace'

function makeTransport() {
  let listener: ((event: NearbyEvent) => void) | undefined
  const host = vi.fn(async (_name: string) => undefined)
  const scan = vi.fn(async () => undefined)
  const stop = vi.fn(async () => undefined)
  const transport: NearbyTransport = {
    subscribe(callback) { listener = callback; return () => { listener = undefined } },
    host, scan,
    connect: async () => undefined,
    respond: async () => undefined,
    lock: async () => undefined,
    send: async () => undefined,
    stop,
  }
  return { transport, host, scan, stop, emit: (event: NearbyEvent) => listener?.(event) }
}

describe('native nearby connection selection', () => {
  it('keeps Android Nearby as the default and permits choosing LAN before a race', async () => {
    const android = makeTransport()
    const lan = makeTransport()
    const selected = selectNearbyConnection(android.transport, lan.transport)
    expect(selected.modes?.current()).toBe('android')
    const events: NearbyEvent[] = []
    selected.transport?.subscribe(event => events.push(event))
    expect(selected.modes?.choose('lan')).toBe(true)
    await selected.transport?.scan()
    expect(lan.scan).toHaveBeenCalledOnce()
    expect(android.scan).not.toHaveBeenCalled()
    lan.emit({ type: 'found', id: '192.168.1.2:47832', name: 'Room 1234' })
    android.emit({ type: 'found', id: 'other', name: 'Room 1111' })
    expect(events).toEqual([{ type: 'found', id: '192.168.1.2:47832', name: 'Room 1234' }])
    expect(selected.modes?.choose('android')).toBe(false)
    await selected.transport?.stop()
    expect(selected.modes?.choose('android')).toBe(true)
    await selected.transport?.host('Room 1234')
    expect(android.host).toHaveBeenCalledWith('Room 1234')
  })

  it('runs LAN-only on Windows and protects against selecting an unavailable adapter', async () => {
    const lan = makeTransport()
    const selected = selectNearbyConnection(undefined, lan.transport)
    expect(selected.modes?.current()).toBe('lan')
    expect(selected.modes?.choose('android')).toBe(false)
    await selected.transport?.host('Room 9000')
    expect(lan.host).toHaveBeenCalledOnce()
    await selected.transport?.stop()
    expect(lan.stop).toHaveBeenCalledOnce()
  })

  it('releases the mode guard when hosting fails visibly', async () => {
    const android = makeTransport()
    android.host.mockRejectedValueOnce(new Error('Bluetooth unavailable'))
    const lan = makeTransport()
    const selected = selectNearbyConnection(android.transport, lan.transport)
    await expect(selected.transport?.host('Room 1111')).rejects.toThrow('Bluetooth unavailable')
    expect(selected.modes?.choose('lan')).toBe(true)
  })
})
