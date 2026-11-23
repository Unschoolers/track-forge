import { describe, expect, it, vi } from 'vitest'
import { NearbyRace, validLanIp, type NearbyTransport } from '@/application/multiplayer/nearbyRace'

function transport() {
  const scan = vi.fn(async () => undefined)
  const connectDirect = vi.fn(async (_ip: string) => undefined)
  const stop = vi.fn(async () => undefined)
  const adapter: NearbyTransport = {
    subscribe: () => () => {},
    host: async () => undefined,
    scan,
    connect: async () => undefined,
    connectDirect,
    respond: async () => undefined,
    lock: async () => undefined,
    send: async () => undefined,
    stop,
  }
  return { adapter, scan, connectDirect, stop }
}

describe('direct local Wi-Fi join fallback', () => {
  it('only accepts literal private IPv4 addresses, not DNS, public or injected destinations', () => {
    for (const ip of ['192.168.1.20', '10.0.0.2', '172.16.2.9', '172.31.255.254', '169.254.1.6'])
      expect(validLanIp(ip), ip).toBe(true)
    for (const ip of ['', 'localhost', '8.8.8.8', '127.0.0.1', '192.168.1.20:47832', '192.168.1.20/24',
      '172.32.0.1', '192.168.01.1', '255.255.255.255', '192.168.1.999', '192.168.1.2;rm'])
      expect(validLanIp(ip), ip).toBe(false)
  })

  it('connects directly even when room discovery returns no results', async () => {
    const fake = transport()
    const race = new NearbyRace(fake.adapter, () => true)
    race.scan('blue')
    expect(race.snapshot().rooms).toHaveLength(0)
    race.connectByIp(' 192.168.1.20 ')
    await vi.waitFor(() => expect(fake.connectDirect).toHaveBeenCalledWith('192.168.1.20'))
    expect(race.snapshot()).toMatchObject({ role: 'guest', phase: 'connecting', room: 'LAN 192.168.1.20' })
    race.close()
  })

  it('stays in scanning mode and gives a visible error for invalid input', () => {
    const fake = transport()
    const race = new NearbyRace(fake.adapter, () => true)
    race.scan('blue')
    race.connectByIp('8.8.8.8')
    expect(race.snapshot().phase).toBe('scanning')
    expect(race.snapshot().error).toContain('private LAN IPv4')
    expect(fake.connectDirect).not.toHaveBeenCalled()
    race.close()
  })
})
