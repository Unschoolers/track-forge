import { describe, expect, it } from 'vitest'
import { activePosePackets } from '@/application/multiplayer/nearbyPoseSync'

describe('host relay packet selection', () => {
  it('keeps valid, live and unfinished racers in insertion order', () => {
    const recent = new Uint8Array([1])
    const stale = new Uint8Array([2])
    const finished = new Uint8Array([3])
    const left = new Uint8Array([4])
    const unknown = new Uint8Array([5])
    const poses = new Map([
      [2, { bytes: recent, receivedAt: 800 }],
      [1, { bytes: stale, receivedAt: 699 }],
      [3, { bytes: finished, receivedAt: 900 }],
      [0, { bytes: left, receivedAt: 999 }],
      [9, { bytes: unknown, receivedAt: 1000 }],
    ])
    const racers = new Map([
      [2, { left: false, time: undefined }],
      [1, { left: false, time: undefined }],
      [3, { left: false, time: 35 }],
      [0, { left: true, time: undefined }],
    ])
    expect(activePosePackets(poses, racers, 1000)).toEqual([recent])
  })

  it('retains the 300ms boundary and excludes peers with a null finish', () => {
    const pose = new Uint8Array([8])
    const packets = new Map([[1, { bytes: pose, receivedAt: 700 }]])
    const playing = new Map([[1, { time: undefined, left: false }]])
    expect(activePosePackets(packets, playing, 1000)).toEqual([pose])
    expect(activePosePackets(packets, playing, 1001)).toEqual([])
    expect(activePosePackets(packets, new Map([[1, { time: null, left: false }]]), 1000)).toEqual([])
  })
})
