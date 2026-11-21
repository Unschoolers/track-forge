// @vitest-environment node
import { assert, describe, expect, it } from 'vitest'
import {
  decodePose, decodePoseBatch, encodePose, encodePoseBatch, Packet,
  POSE_BYTES, POSE_FAST_PERIOD_MS, POSE_PERIOD_MS, RemoteGhost,
} from '@/application/multiplayer/raceWire'
import { packTrack, TrackReceiver } from '@/application/multiplayer/trackTransfer'
import type { Track } from '@/domain/model'
import { nearbyCar as makeCar, nearbyTrack as track } from '../fixtures/nearbyRace'

describe('Nearby wire and track transfer contracts', () => {
  it('compresses a custom circuit and reassembles out-of-order track chunks', async () => {
    const scenicTrack: Track = {
      ...track,
      name: 'Épreuve du pont',
      trees: Array.from({ length: 2400 }, (_, index) => ({
        x: Math.sin(index * 1.45) * 1400,
        y: Math.cos(index * 0.67) * 1230,
      })),
    }
    const chunks = await packTrack(scenicTrack)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.reduce((total, packet) => total + packet.length, 0)).toBeLessThan(JSON.stringify(scenicTrack).length / 2)
    const receiver = new TrackReceiver()
    let received: Track | null = null
    for (const packet of chunks.toReversed()) {
      received = await receiver.receive(new Uint8Array(packet))
    }
    expect(received?.name).toBe(scenicTrack.name)
    expect(received?.trees).toEqual(scenicTrack.trees)
    expect(received?.points).toEqual(scenicTrack.points)
  })

  it('round-trips and validates four-player batches without duplicate or malformed slots', () => {
    expect(POSE_PERIOD_MS).toBeCloseTo(1000 / 30)
    expect(POSE_FAST_PERIOD_MS).toBeCloseTo(1000 / 60)
    const blue = encodePose(0, 1, 0, makeCar('blue', 12))
    const red = encodePose(1, 2, 0, makeCar('red', 24))
    const batch = encodePoseBatch([blue, red])
    expect(batch.byteLength).toBe(1 + 2 * POSE_BYTES)
    expect(decodePoseBatch(batch)?.map(({ slot, pose }) => [slot, pose.x])).toEqual([[0, 12], [1, 24]])
    expect(decodePoseBatch(batch.subarray(0, batch.length - 1))).toBeNull()
    expect(decodePoseBatch(new Uint8Array([Packet.PoseBatch]))).toBeNull()
    expect(decodePoseBatch(encodePoseBatch([blue]))).toHaveLength(1)
    expect(() => encodePoseBatch([blue, blue])).toThrow(RangeError)
    expect(() => encodePoseBatch([])).toThrow(RangeError)
    const duplicate = new Uint8Array(batch)
    duplicate.set(blue, 1 + POSE_BYTES)
    expect(decodePoseBatch(duplicate)).toBeNull()
    expect(decodePoseBatch(new Uint8Array(1 + 5 * POSE_BYTES).fill(Packet.PoseBatch))).toBeNull()
  })

  it('interpolates at 30-60 Hz and briefly predicts movement without crossing recoveries', () => {
    const ghost = new RemoteGhost('red')
    const pose = (sequence: number, recovery: number, x: number) =>
      decodePose(encodePose(1, sequence, recovery, makeCar('red', x)))
    const first = pose(1, 0, 0)
    const second = pose(2, 0, 10)
    assert(first && second)
    expect(ghost.receive(first, 1000)).toBe(true)
    expect(ghost.receive(second, 1033)).toBe(true)
    expect(ghost.pose(1150)?.x).toBeGreaterThan(10)
    const recovered = pose(3, 1, 500)
    assert(recovered)
    expect(ghost.receive(recovered, 1160)).toBe(true)
    expect(ghost.pose(1270)?.x).toBe(500)
    expect(ghost.pose(1950)).toBeNull()
  })

  it('round-trips a 19-byte pose and cuts interpolation on a recovery', () => {
    const ghost = new RemoteGhost('red')
    const packet = (sequence: number, reset: number, x: number, z: number, bridge: boolean) => {
      const bytes = encodePose(2, sequence, reset, makeCar('red', x, z, bridge ? 'bridge' : null))
      expect(bytes.byteLength).toBe(19)
      const pose = decodePose(bytes)
      assert(pose, 'Expected a valid pose packet')
      return pose
    }
    const first = packet(65535, 0, 9_000_000.01, 29.07, true)
    expect(first).toMatchObject({ slot: 2, sequence: 65535, recovery: 0, pose: { structureRunId: 'elevated', y: -3.25 } })
    expect(first.pose.x).toBeCloseTo(9_000_000.01, 1)
    expect(first.pose.z).toBeCloseTo(29.07, 1)
    expect(first.pose.angle).toBeCloseTo(2 * Math.PI - 0.01, 3)
    expect(ghost.receive(first, 1000)).toBe(true)
    expect(ghost.receive(packet(0, 1, -75, 0, false), 1050)).toBe(true)
    expect(ghost.receive(first, 1060)).toBe(false)
    expect(ghost.pose(1125)?.x).toBe(first.pose.x)
    expect(ghost.pose(1150)).toMatchObject({ car: 'red', x: -75, z: 0, structureRunId: null })
    expect(ghost.pose(1850)).toBeNull()
    expect(decodePose(new Uint8Array(18))).toBeNull()
  })
})
