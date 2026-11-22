import { describe, expect, it, vi } from 'vitest'
import { NearbyPoseSync, type PoseRacer } from '@/application/multiplayer/nearbyPoseSync'
import { NearbyProgressSync } from '@/application/multiplayer/nearbyProgressSync'
import { DEFAULT_PLAYER_IDENTITY } from '@/application/multiplayer/playerIdentity'
import {
  decodePose, decodePoseBatch, decodeProgress, encodePose, encodePoseBatch,
  encodeProgress, RemoteGhost, POSE_BYTES, PROGRESS_BYTES,
} from '@/application/multiplayer/raceWire'
import { nearbyCar } from '../fixtures/nearbyRace'

const rival = nearbyCar('red', 40)

describe('Nearby rematch packet round isolation', () => {
  it('encodes a 5-bit round epoch without increasing 19/8-byte packet sizes', () => {
    const pose = encodePose(1, 1, 0, rival, 17)
    const progress = encodeProgress(1, 1, 13.25, 17)
    expect(pose).toHaveLength(POSE_BYTES)
    expect(progress).toHaveLength(PROGRESS_BYTES)
    expect(decodePose(pose)).toMatchObject({ slot: 1, round: 17, sequence: 1 })
    expect(decodeProgress(progress)).toEqual({ slot: 1, round: 17, sequence: 1, progress: 13.25 })
    expect(decodePose(encodePose(1, 1, 0, rival))?.round).toBe(0)
    expect(decodeProgress(encodeProgress(1, 1, 0))?.round).toBe(0)
    expect(decodeProgress(new Uint8Array([4, 0x80, 0, 0, 0, 0, 0, 0]))).toBeNull()
    expect(() => encodePose(1, 1, 0, rival, -1)).toThrow(RangeError)
    expect(() => encodeProgress(1, 1, 13, 65536)).toThrow(RangeError)
  })

  it('rejects mixing old and new rounds within a host pose batch', () => {
    const old = encodePose(1, 30, 0, rival, 0)
    const next = encodePose(2, 0, 0, rival, 1)
    expect(() => encodePoseBatch([old, next])).toThrow(RangeError)
    const valid = encodePoseBatch([next])
    expect(decodePoseBatch(valid)?.[0]?.round).toBe(1)
  })

  it('drops late previous-round poses before they contaminate fresh sequence state', () => {
    let now = 100
    const sync = new NearbyPoseSync(async () => undefined, () => now)
    const racers = new Map<number, PoseRacer>([
      [1, { ghost: new RemoteGhost('red'), identity: DEFAULT_PLAYER_IDENTITY }],
    ])
    sync.setRound(1)
    expect(sync.receive(encodePose(1, 65535, 0, rival, 0), false, 1, 0, racers)).toBe(true)
    expect(sync.counts.relayed).toBe(0)
    expect(sync.receive(encodePose(1, 0, 0, rival, 1), false, 1, 0, racers)).toBe(true)
    expect(sync.counts.relayed).toBe(1)
    now += 20
    expect(sync.receive(encodePose(1, 1, 0, rival, 1), false, 1, 0, racers)).toBe(true)
    expect(sync.counts.relayed).toBe(2)
    sync.reset()
    sync.setRound(2)
    expect(sync.receive(encodePose(1, 65535, 0, rival, 1), false, 1, 0, racers)).toBe(true)
    expect(sync.counts.relayed).toBe(0)
  })

  it('rejects old-round progress both on receive and host relay', async () => {
    const send = vi.fn(async () => undefined)
    const sync = new NearbyProgressSync(send, () => 100)
    sync.setRound(4)
    expect(sync.receive(decodeProgress(encodeProgress(1, 65535, 10, 3))!)).toBe(false)
    expect(sync.receive(decodeProgress(encodeProgress(1, 0, 12, 4))!)).toBe(true)
    sync.relay(encodeProgress(1, 65535, 10, 3), ['guest'])
    expect(send).not.toHaveBeenCalled()
    sync.relay(encodeProgress(1, 0, 12, 4), ['guest'])
    await Promise.resolve()
    expect(send).toHaveBeenCalledOnce()
    sync.update(0, 20, ['guest'])
    expect(decodeProgress(send.mock.calls.at(-1)?.[1] ?? new Uint8Array())?.round).toBe(4)
  })
})
