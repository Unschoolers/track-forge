import { describe, expect, it } from 'vitest'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { DEFAULT_PLAYER_IDENTITY } from '@/application/multiplayer/playerIdentity'
import { NearbyPoseSync, type PoseRacer } from '@/application/multiplayer/nearbyPoseSync'
import { decodePose, decodePoseBatch, encodePose, Packet, RemoteGhost } from '@/application/multiplayer/raceWire'

const track = createStarterTrack(asTrackId('pose-sync'), 1)
const race = createRace({ path: buildRoadPath(track.points, track.terrain), playerCar: 'blue', difficulty: 'normal', laps: 1 })
const player = race.vehicles[0]
const rival = race.vehicles[1]
if (!player || !rival) throw new Error('Expected race vehicles')
const racers = new Map<number, PoseRacer>([
  [0, { ghost: new RemoteGhost(player.car), identity: DEFAULT_PLAYER_IDENTITY }],
  [1, { ghost: new RemoteGhost(rival.car), identity: DEFAULT_PLAYER_IDENTITY }],
])

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('nearby pose synchronizer', () => {
  it('sends bounded 30 Hz guest poses and increments the recovery byte', async () => {
    let now = 0
    const payloads: Uint8Array[] = []
    const sync = new NearbyPoseSync(async (_ids, bytes) => { payloads.push(bytes) }, () => now)
    sync.setStartAt(0)
    sync.update(player, 1, 'host', ['host'], racers)
    await flush()
    sync.update(player, 1, 'host', ['host'], racers)
    expect(payloads).toHaveLength(1)
    now += 10
    sync.update(player, 1, 'host', ['host'], racers)
    expect(payloads).toHaveLength(1)
    now += 24
    sync.recovered()
    sync.update(player, 1, 'host', ['host'], racers)
    expect(payloads).toHaveLength(2)
    expect(payloads[0]?.[0]).toBe(Packet.Pose)
    expect(decodePose(payloads[1] ?? new Uint8Array())).toMatchObject({ slot: 1, sequence: 1, recovery: 1 })
    expect(sync.counts.sent).toBe(2)
  })

  it('timestamps on shared GO and keeps guest sample time through host batches', async () => {
    let now = 5000
    const sent: Uint8Array[] = []
    const host = new NearbyPoseSync(async (_ids, bytes) => { sent.push(bytes) }, () => now)
    host.setStartAt(4000)
    const localRacers = new Map<number, PoseRacer>([
      [0, { ghost: new RemoteGhost(player.car), identity: DEFAULT_PLAYER_IDENTITY }],
      [1, { ghost: new RemoteGhost(rival.car), identity: DEFAULT_PLAYER_IDENTITY }],
    ])
    expect(host.receive(encodePose(1, 0, 0, rival, 0, 980).subarray(0, 19), false, 1, 0, localRacers)).toBe(true)
    expect(host.counts.relayed).toBe(0)
    expect(host.receive(encodePose(1, 0, 0, rival, 0, 980), false, 1, 0, localRacers)).toBe(true)
    host.update(player, 0, null, ['guest'], localRacers)
    await flush()
    expect(decodePoseBatch(sent[0]!)?.map(p => [p.slot, p.sampleTimeMs])).toEqual([[1, 980], [0, 1000]])
    expect(localRacers.get(1)?.ghost.presentationDiagnostics().meanSampleAgeMs).toBe(20)
    now += 100
    host.reset()
    expect(host.counts.sent).toBe(0)
  })

  it('rejects guest slot spoofing, deduplicates relays and batches active host and rival positions', async () => {
    let now = 200
    const payloads: Uint8Array[] = []
    const sync = new NearbyPoseSync(async (_ids, bytes) => { payloads.push(bytes) }, () => now)
    sync.setStartAt(0)
    const bad = encodePose(2, 1, 0, rival, 0, 0)
    expect(sync.receive(bad, false, 1, 0, racers)).toBe(true)
    expect(sync.counts.relayed).toBe(0)
    const valid = encodePose(1, 1, 0, rival, 0, now)
    expect(sync.receive(valid, false, 1, 0, racers)).toBe(true)
    expect(sync.receive(valid, false, 1, 0, racers)).toBe(true)
    expect(sync.counts.relayed).toBe(1)
    sync.update(player, 0, null, ['guest'], racers)
    expect(payloads).toHaveLength(1)
    const batch = decodePoseBatch(payloads[0] ?? new Uint8Array())
    expect(batch?.map(p => p.slot)).toEqual([1, 0])
    await flush()
    now = 2400
    sync.update(player, 0, null, ['guest'], racers)
    const later = decodePoseBatch(payloads[1] ?? new Uint8Array())
    expect(later?.map(p => p.slot)).toEqual([0])
  })

  it('never exceeds 30 Hz even with healthy transport, and records a failed send', async () => {
    let now = 0
    let fail = false
    const sync = new NearbyPoseSync(async () => {
      if (fail) throw new Error('radio failure')
    }, () => now)
    sync.setStartAt(0)
    for (let i = 0; i < 40; i++) {
      now = i * 17
      sync.update(player, 1, 'host', ['host'], racers)
      await flush()
    }
    expect(sync.targetPoseHz).toBe(30)
    expect(sync.counts.sent).toBeLessThanOrEqual(21)
    fail = true
    now += 40
    sync.update(player, 1, 'host', ['host'], racers)
    await flush()
    expect(sync.counts.sendFailed).toBe(1)
  })

  it('maintains the target cadence across mixed refresh intervals without catch-up bursts', async () => {
    let now = 0
    const sentAt: number[] = []
    const sync = new NearbyPoseSync(async () => { sentAt.push(now) }, () => now)
    sync.setStartAt(0)
    // Mixed 120/60/40/30 Hz render intervals, representative of mobile vsync.
    const gaps = [8.3, 25, 16.7, 25, 8.3, 33.3, 8.4, 8.3]
    for (let i = 0; i < 600; i++) {
      now += gaps[i % gaps.length]!
      sync.update(player, 1, 'host', ['host'], racers)
      await flush()
    }
    const rate = sentAt.length / (now / 1000)
    expect(rate).toBeGreaterThan(28)
    expect(rate).toBeLessThanOrEqual(30.2)
    expect(sentAt.slice(1).every((at, i) => at - sentAt[i]! >= 1000 / 60)).toBe(true)
    const beforeStall = sentAt.length
    now += 1000
    sync.update(player, 1, 'host', ['host'], racers)
    await flush()
    sync.update(player, 1, 'host', ['host'], racers)
    expect(sentAt).toHaveLength(beforeStall + 1)
  })

  it('does not queue stale poses while native admission is pending', async () => {
    let now = 0
    const sentAt: number[] = []
    let release: (() => void) | undefined
    const sync = new NearbyPoseSync(() => new Promise<void>(resolve => {
      sentAt.push(now)
      release = resolve
    }), () => now)
    sync.setStartAt(0)
    sync.update(player, 1, 'host', ['host'], racers)
    for (now = 10; now <= 200; now += 10) sync.update(player, 1, 'host', ['host'], racers)
    expect(sentAt).toEqual([0])
    release?.()
    await flush()
    sync.update(player, 1, 'host', ['host'], racers)
    expect(sentAt).toEqual([0, 210])
    release?.()
    await flush()
  })

  it('discards late sends after room reset and restores fresh sequence and metrics', async () => {
    let complete: (() => void) | undefined
    const sync = new NearbyPoseSync(() => new Promise<void>(resolve => { complete = resolve }), () => 0)
    sync.setStartAt(0)
    sync.update(player, 1, 'host', ['host'], racers)
    expect(sync.counts.sent).toBe(1)
    sync.reset()
    complete?.()
    await flush()
    expect(sync.counts).toEqual({ sent: 0, received: 0, sendFailed: 0, relayed: 0 })
    expect(sync.targetPoseHz).toBe(30)
    sync.update(player, 1, 'host', ['host'], racers)
    expect(sync.counts.sent).toBe(0)
    sync.setStartAt(0)
    sync.update(player, 1, 'host', ['host'], racers)
    expect(sync.counts.sent).toBe(1)
  })
  it('sends one compact batch to all recipients on the same frame', async () => {
    let now = 0
    const sends: { ids: string[]; bytes: Uint8Array }[] = []
    const sync = new NearbyPoseSync(async (ids, bytes) => {
      sends.push({ ids, bytes })
    }, () => now)
    sync.setStartAt(0)
    sync.update(player, 0, null, ['guest-1', 'guest-2', 'guest-3'], racers)
    await flush()
    now = 34
    sync.update(player, 0, null, ['guest-1', 'guest-2', 'guest-3'], racers)
    await flush()
    expect(sends).toHaveLength(2)
    expect(sends[0]?.ids).toEqual(['guest-1', 'guest-2', 'guest-3'])
    expect(sends[1]?.ids).toEqual(['guest-1', 'guest-2', 'guest-3'])
    expect(decodePoseBatch(sends[1]?.bytes ?? new Uint8Array())?.[0]?.sequence).toBe(1)
    expect(sync.counts.sent).toBe(2)
  })


})
