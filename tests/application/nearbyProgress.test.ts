import { describe, expect, it, vi } from 'vitest'
import { NearbyProgressSync } from '@/application/multiplayer/nearbyProgressSync'
import { decodePose, decodeProgress, encodePose, encodeProgress, Packet, POSE_BYTES, PROGRESS_BYTES } from '@/application/multiplayer/raceWire'
import { nearbyCar } from '../fixtures/nearbyRace'

describe('nearby progress telemetry', () => {
  it('round-trips a bounded eight-byte packet without changing legacy poses', () => {
    const packet = encodeProgress(2, 65_535, 123.5)
    expect(packet).toHaveLength(PROGRESS_BYTES)
    expect(decodeProgress(packet)).toEqual({ slot: 2, sequence: 65_535, progress: 123.5 })
    const pose = encodePose(2, 1, 0, nearbyCar('red', 40))
    expect(pose).toHaveLength(POSE_BYTES)
    expect(decodePose(pose)?.slot).toBe(2)
    expect(decodeProgress(pose)).toBeNull()
    expect(decodeProgress(packet.subarray(0, PROGRESS_BYTES - 1))).toBeNull()
    expect(decodeProgress(new Uint8Array([Packet.Progress, 255, 0, 0, 0, 0, 0, 0]))).toBeNull()
    const invalid = new Uint8Array(packet)
    new DataView(invalid.buffer).setFloat32(4, Number.NaN, true)
    expect(decodeProgress(invalid)).toBeNull()
    expect(() => encodeProgress(4, 1, 1)).toThrow(RangeError)
    expect(() => encodeProgress(1, 0, Infinity)).toThrow(RangeError)
  })

  it('throttles updates, rejects duplicates and stale frames, and expires lost peers', () => {
    let now = 1000
    const sent: Uint8Array[] = []
    const send = vi.fn(async (_ids: string[], bytes: Uint8Array) => { sent.push(bytes) })
    const producer = new NearbyProgressSync(send, () => now)
    producer.update(0, 25, ['host'])
    now += 100
    producer.update(0, 29, ['host'])
    expect(sent).toHaveLength(1)
    now += 51
    producer.update(0, 32, ['host'])
    expect(sent).toHaveLength(2)
    const consumer = new NearbyProgressSync(async () => undefined, () => now)
    const newest = decodeProgress(sent[1]!)
    const oldest = decodeProgress(sent[0]!)
    expect(newest && consumer.receive(newest)).toBe(true)
    expect(consumer.latest(0)).toBe(32)
    expect(oldest && consumer.receive(oldest)).toBe(false)
    expect(newest && consumer.receive(newest)).toBe(false)
    now += 1501
    expect(consumer.latest(0)).toBeNull()
    consumer.reset()
    expect(consumer.latest(0)).toBeNull()
    expect(consumer.receive(decodeProgress(encodeProgress(0, 65_535, 8))!)).toBe(true)
    expect(consumer.receive(decodeProgress(encodeProgress(0, 0, 9))!)).toBe(true)
    expect(consumer.latest(0)).toBe(9)
  })

  it('counts failed optional sends for diagnostics instead of failing the race silently', async () => {
    const sync = new NearbyProgressSync(async () => { throw Error('radio failed') }, () => 100)
    sync.update(0, 3, ['host'])
    await vi.waitFor(() => expect(sync.failedSends).toBe(1))
  })
})
