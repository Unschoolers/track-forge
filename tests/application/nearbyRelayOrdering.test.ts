import { describe, expect, it, vi } from 'vitest'
import { NearbyProgressSync } from '@/application/multiplayer/nearbyProgressSync'
import { decodeProgress, encodeProgress } from '@/application/multiplayer/raceWire'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('nearby host progress relays', () => {
  it('forwards the newest sequence once and drops stale or duplicate packets after send completion', async () => {
    const sent: number[] = []
    const sync = new NearbyProgressSync(async (_recipients, bytes) => {
      const packet = decodeProgress(bytes)
      if (!packet) throw new Error('Expected valid progress packet')
      sent.push(packet.sequence)
    }, () => 0)
    sync.relay(encodeProgress(1, 100, 1), ['guest'])
    await flush()
    sync.relay(encodeProgress(1, 100, 1), ['guest'])
    sync.relay(encodeProgress(1, 99, 1), ['guest'])
    sync.relay(encodeProgress(1, 101, 1), ['guest'])
    await flush()
    expect(sent).toEqual([100, 101])
  })

  it('accepts sequence rollover and clears relay ordering on room reset', async () => {
    const send = vi.fn(async () => undefined)
    const sync = new NearbyProgressSync(send, () => 0)
    sync.relay(encodeProgress(2, 65_535, 1), ['guest'])
    await flush()
    sync.relay(encodeProgress(2, 0, 2), ['guest'])
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
    sync.reset()
    sync.relay(encodeProgress(2, 65_534, 1), ['guest'])
    await flush()
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('allows retry of a relay when transport rejected the first send', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('radio failed'))
      .mockResolvedValue(undefined)
    const sync = new NearbyProgressSync(send, () => 0)
    const packet = encodeProgress(1, 8, 2)
    sync.relay(packet, ['guest'])
    await flush()
    expect(sync.failedSends).toBe(1)
    sync.relay(packet, ['guest'])
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
  })
})
