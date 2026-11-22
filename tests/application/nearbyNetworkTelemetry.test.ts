// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NearbyNetworkTelemetry } from '@/application/multiplayer/nearbyNetworkTelemetry'

describe('Nearby per-player diagnostics', () => {
  it('records real receive gaps, rejected updates and sequence jumps independently per slot', () => {
    const telemetry = new NearbyNetworkTelemetry()
    telemetry.recordPose(1, 10, true, 100)
    telemetry.recordPose(1, 13, true, 200)
    telemetry.recordPose(1, 12, false, 210)
    telemetry.recordPose(1, 14, true, 500)
    telemetry.recordPose(1, 15, true, 2800)
    telemetry.recordProgress(2, 65535, true, 100)
    telemetry.recordProgress(2, 0, true, 250)

    const players = telemetry.snapshot(5100, 0)
    expect(players[1]?.pose).toMatchObject({
      accepted: 4, rejectedStaleOrDuplicate: 1, sequenceJumps: 1, skippedSamples: 2,
      firstAtMs: 100, lastAtMs: 2800, lastSequence: 15, silenceMs: 2300,
      expired: true, meanGapMs: 900, maxGapMs: 2300,
      p95GapUpperBoundMs: 2300, gapsOver250Ms: 2,
      gapsOver500Ms: 1, gapsOver2000Ms: 1,
    })
    expect(players[2]?.pose).toMatchObject({ accepted: 0, silenceMs: null, expired: false })
    expect(players[2]?.progress).toMatchObject({ accepted: 2, sequenceJumps: 0, skippedSamples: 0, maxGapMs: 150 })
    expect(players[1]?.progress).toMatchObject({ accepted: 0, maxGapMs: null })
  })

  it('keeps fixed memory and bounded counters across a long 60 Hz race', () => {
    const telemetry = new NearbyNetworkTelemetry()
    for (let i = 0; i < 20_000; i++) {
      telemetry.recordPose(3, i & 0xffff, true, i * 17)
    }
    const stats = telemetry.snapshot(340_000, 0)[3]?.pose
    expect(stats).toMatchObject({
      accepted: 20_000, sequenceJumps: 0, skippedSamples: 0,
      maxGapMs: 17, p95GapUpperBoundMs: 34, gapsOver250Ms: 0,
      expired: false,
    })
    expect(JSON.stringify(stats).length).toBeLessThan(500)
  })
})
