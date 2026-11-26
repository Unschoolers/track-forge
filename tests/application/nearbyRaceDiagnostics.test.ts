// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NearbyRaceDiagnostics } from '@/application/multiplayer/nearbyRaceDiagnostics'
import { NearbyLobby } from '@/application/multiplayer/nearbyLobby'
import { DEFAULT_PLAYER_IDENTITY } from '@/application/multiplayer/playerIdentity'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'

type Context = ReturnType<ConstructorParameters<typeof NearbyRaceDiagnostics>[1]>

const counters = { poseCounts: { sent: 0, received: 0, sendFailed: 0, relayed: 0 },
  progressSendFailures: 0, targetPoseHz: 30 }

function setup() {
  let now = 100
  const track = createStarterTrack(asTrackId('diagnostics-track'), 1)
  const lobby = new NearbyLobby()
  lobby.receiveChoice('private-peer', { car: 'red', identity: DEFAULT_PLAYER_IDENTITY,
    accepted: true, choice: 1, name: 'Guest' })
  let context: Context = {
    phase: 'lobby', purpose: 'race', role: 'host', round: 0, cupTotal: 0, cupIndex: 0,
    slot: 0, hostId: null, course: { track, car: 'blue', lighting: 'day', laps: 2 },
    localCar: 'blue', localIdentity: DEFAULT_PLAYER_IDENTITY, localDisplayName: 'Host',
    rooms: 0, pendingPairs: 0, guests: new Map([['private-peer', 1]]),
    racers: new Map(), lobby, progressSync: { latest: () => null },
  }
  const diagnostics = new NearbyRaceDiagnostics(() => now, () => context)
  diagnostics.begin()
  return { diagnostics, track, lobby, tick: (ms: number) => { now += ms },
    change: (patch: Partial<Context>) => { context = { ...context, ...patch } } }
}

describe('NearbyRaceDiagnostics', () => {
  it('retains the v2 report and last race after room teardown, with private peer IDs omitted', () => {
    const { diagnostics, track, lobby, tick, change } = setup()
    tick(100)
    diagnostics.recordPose(1, 4, true, 200)
    diagnostics.recordProgress(1, 8, true, 200)
    diagnostics.failure('test_failure', 'flow_error')
    const before = diagnostics.report(counters)
    expect(before).toMatchObject({
      version: 2, monotonicStartedAtMs: 100, role: 'host', phase: 'lobby', counts: { guests: 1, ready: 1 },
      race: { round: 0, elapsedMs: 100, track: { id: track.id, laps: 2 },
        players: [
          { slot: 0, local: true, car: 'blue', name: 'Host' },
          { slot: 1, local: false, car: 'red', name: 'Guest',
            receive: { pose: { accepted: 1 }, progress: { accepted: 1 } } },
        ] },
      lastFailure: { source: 'test_failure', phase: 'lobby', error: 'flow_error' },
    })
    diagnostics.finishRoom()
    lobby.reset()
    change({ phase: 'idle', course: null, guests: new Map() })
    const after = diagnostics.report(counters)
    expect(after.race).toEqual(before.race)
    expect(after.lastFailure).toEqual(before.lastFailure)
    expect(JSON.stringify(after)).not.toContain('private-peer')
  })

  it('resets round telemetry independently of room history and clears history in a new room', () => {
    const { diagnostics, tick, change } = setup()
    for (let index = 0; index < 120; index++) {
      tick(1)
      diagnostics.record('sample', { index })
    }
    diagnostics.recordPose(1, 1, true, 220)
    diagnostics.finishRound()
    change({ round: 1 })
    const next = diagnostics.report(counters)
    expect(next.timeline).toHaveLength(100)
    expect(next.race).toMatchObject({ round: 1, players: [
      { slot: 0 }, { slot: 1, receive: { pose: { accepted: 0 } } },
    ] })
    diagnostics.failure('test_failure', 'flow_error')
    diagnostics.begin()
    expect(diagnostics.report(counters)).toMatchObject({ timeline: [], lastFailure: null })
  })
})
