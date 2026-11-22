import { describe, expect, it } from 'vitest'
import { NearbyReplayTrace } from '@/application/multiplayer/nearbyReplayTrace'

describe('bounded Nearby race trajectory diagnostics', () => {
  const sample = (t: number) => ({
    elapsed: t / 1000,
    local: { slot: 0, car: 'blue', x: t, y: 3, z: 0, angle: 1, lap: 0, sector: 1, pathIndex: 2, speed: 10 },
    rivals: [{ slot: 1, car: 'red', visible: false }],
  } as const)

  it('keeps a sampled ordered ring without growing for a long race', () => {
    const trace = new NearbyReplayTrace(3, 125)
    trace.record(0, sample(0))
    trace.record(40, sample(40))
    trace.record(125, sample(125))
    trace.record(250, sample(250))
    trace.record(375, sample(375))
    expect(trace.snapshot()).toMatchObject({
      intervalMs: 125,
      limit: 3,
      truncated: 1,
      frames: [{ elapsed: 0.125 }, { elapsed: 0.25 }, { elapsed: 0.375 }],
    })
    trace.reset()
    expect(trace.snapshot().frames).toEqual([])
    expect(trace.snapshot().truncated).toBe(0)
  })

  it('checks sample eligibility before allocating rival snapshots', () => {
    const trace = new NearbyReplayTrace(5, 125)
    expect(trace.shouldRecord(0)).toBe(true)
    trace.record(0, sample(0))
    expect(trace.shouldRecord(40)).toBe(false)
    expect(trace.shouldRecord(124)).toBe(false)
    expect(trace.shouldRecord(125)).toBe(true)
    expect(trace.shouldRecord(40, true)).toBe(true)
    expect(trace.shouldRecord(Number.NaN)).toBe(false)
  })

  it('captures missing opponent visibility explicitly and supports a forced terminal frame', () => {
    const trace = new NearbyReplayTrace(5, 125)
    trace.record(10, sample(10))
    trace.record(20, sample(20))
    expect(trace.snapshot().frames).toHaveLength(1)
    trace.record(20, sample(20), true)
    expect(trace.snapshot().frames).toHaveLength(2)
    expect(trace.snapshot().frames[1]?.rivals).toEqual([{ slot: 1, car: 'red', visible: false }])
  })
})
