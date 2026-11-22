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

  it('rejects guest slot spoofing, deduplicates relays and batches active host and rival positions', async () => {
    let now = 200
    const payloads: Uint8Array[] = []
    const sync = new NearbyPoseSync(async (_ids, bytes) => { payloads.push(bytes) }, () => now)
    const bad = encodePose(2, 1, 0, rival)
    expect(sync.receive(bad, false, 1, 0, racers)).toBe(true)
    expect(sync.counts.relayed).toBe(0)
    const valid = encodePose(1, 1, 0, rival)
    expect(sync.receive(valid, false, 1, 0, racers)).toBe(true)
    expect(sync.receive(valid, false, 1, 0, racers)).toBe(true)
    expect(sync.counts.relayed).toBe(1)
    sync.update(player, 0, null, ['guest'], racers)
    expect(payloads).toHaveLength(1)
    const batch = decodePoseBatch(payloads[0] ?? new Uint8Array())
    expect(batch?.map(p => p.slot)).toEqual([1, 0])
    await flush()
    now = 600
    sync.update(player, 0, null, ['guest'], racers)
    const later = decodePoseBatch(payloads[1] ?? new Uint8Array())
    expect(later?.map(p => p.slot)).toEqual([0])
  })

  it('adapts to 60 Hz after healthy sends and falls back to 30 Hz on failure', async () => {
    let now = 0
    let fail = false
    const sync = new NearbyPoseSync(async () => {
      if (fail) throw new Error('disconnected')
    }, () => now)
    for (let i = 0; i < 30; i++) {
      now = i * 35
      sync.update(player, 1, 'host', ['host'], racers)
      await flush()
    }
    // SDK queue acceptance is not a radio delivery acknowledgement.
    expect(sync.targetPoseHz).toBe(30)
    sync.observeDeliveryQuality({ delivered: 0, failed: 0, dropped: 0, timedOut: 0 })
    now += 1500
    sync.observeDeliveryQuality({ delivered: 45, failed: 0, dropped: 0, timedOut: 0 })
    expect(sync.targetPoseHz).toBe(30)
    now += 1500
    sync.observeDeliveryQuality({ delivered: 90, failed: 0, dropped: 0, timedOut: 0 })
    expect(sync.targetPoseHz).toBe(60)
    fail = true
    now += 35
    sync.update(player, 1, 'host', ['host'], racers)
    await flush()
    expect(sync.counts.sendFailed).toBe(1)
    expect(sync.targetPoseHz).toBe(30)
  })

  it('drops back to 30 Hz on native radio drops and does not recover on enqueue success alone', async () => {
    let now = 0
    const sync = new NearbyPoseSync(async () => undefined, () => now)
    sync.observeDeliveryQuality({ delivered: 0, failed: 0, dropped: 0, timedOut: 0 })
    now = 1500
    sync.observeDeliveryQuality({ delivered: 60, failed: 0, dropped: 0, timedOut: 0 })
    now = 3000
    sync.observeDeliveryQuality({ delivered: 120, failed: 0, dropped: 0, timedOut: 0 })
    expect(sync.targetPoseHz).toBe(60)
    now = 4500
    sync.observeDeliveryQuality({ delivered: 120, failed: 0, dropped: 1, timedOut: 0 })
    expect(sync.targetPoseHz).toBe(30)
    for (let i = 0; i < 35; i++) {
      now += 35
      sync.update(player, 1, 'host', ['host'], racers)
      await flush()
    }
    expect(sync.targetPoseHz).toBe(30)
    // Reset counters must establish a new baseline, not fabricate deliveries.
    sync.observeDeliveryQuality({ delivered: 1, failed: 0, dropped: 0, timedOut: 0 })
    expect(sync.targetPoseHz).toBe(30)
  })

  it('discards late sends after room reset and restores fresh sequence and metrics', async () => {
    let complete: (() => void) | undefined
    const sync = new NearbyPoseSync(() => new Promise<void>(resolve => { complete = resolve }), () => 0)
    sync.update(player, 1, 'host', ['host'], racers)
    expect(sync.counts.sent).toBe(1)
    sync.reset()
    complete?.()
    await flush()
    expect(sync.counts).toEqual({ sent: 0, received: 0, sendFailed: 0, relayed: 0 })
    expect(sync.targetPoseHz).toBe(30)
    sync.update(player, 1, 'host', ['host'], racers)
    expect(sync.counts.sent).toBe(1)
  })
  it('sends one compact batch to all recipients on the same frame', async () => {
    let now = 0
    const sends: { ids: string[]; bytes: Uint8Array }[] = []
    const sync = new NearbyPoseSync(async (ids, bytes) => {
      sends.push({ ids, bytes })
    }, () => now)
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
