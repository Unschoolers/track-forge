import { describe, expect, it } from 'vitest'
import { NearbyClock } from '@/application/multiplayer/nearbyClock'
import { NearbyRanking, rankNearby } from '@/application/multiplayer/nearbyRanking'

describe('shared nearby race authority', () => {
  it('chooses the least queued exchange across independent monotonic clocks', () => {
    const clock = new NearbyClock()
    for (const [i, latency] of [50, 10, 80, 20, 30].entries()) {
      const now = 1000 + i * 200
      expect(clock.request(now)?.probe).toBe(i)
      expect(clock.receive(i + 1, now + 10000, now + 10001, now + 100)).toBe(false)
      expect(clock.receive(i, now + 10000 + latency, now + 10002 + latency, now + 2 * latency + 2)).toBe(true)
    }
    expect(clock.estimate).toEqual({ offsetMs: 10000, roundTripMs: 20 })
    clock.reset()
    expect(clock.estimate).toBeNull()
  })

  it('publishes one order rather than allowing each peer to rank its newer local progress first', () => {
    const host = new NearbyRanking(), guest = new NearbyRanking()
    const order = rankNearby([
      { slot: 0, progress: 100, finish: undefined, left: false },
      { slot: 1, progress: 101, finish: undefined, left: false },
    ])
    host.publish(order, 1000, async (seq, slots) => { guest.receive(seq, slots, 1010) }, () => { throw Error('unexpected failure') })
    expect(host.position(0, 1000)?.position).toBe(2)
    expect(guest.position(1, 1010)?.position).toBe(1)
    expect(guest.receive(0, [0, 1], 1020)).toBe(false)
    expect(guest.position(1, 2511)).toBeNull()
    expect(rankNearby([{ slot: 0, progress: null, finish: undefined, left: false }])).toEqual([])
    expect(rankNearby([
      { slot: 0, progress: 10, finish: 20, left: false },
      { slot: 1, progress: 99, finish: undefined, left: false },
      { slot: 2, progress: null, finish: null, left: true },
    ])).toEqual([0, 1, 2])
  })
})
