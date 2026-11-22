// @vitest-environment node
import { assert, describe, expect, it, vi } from 'vitest'
import { NearbyRace, type NearbyEvent, type NearbyStart, type NearbyTransport } from '@/application/multiplayer/nearbyRace'
import { decodePoseBatch, Packet, POSE_BYTES } from '@/application/multiplayer/raceWire'
import { RaceSession } from '@/application/race/raceSession'
import { createRace } from '@/domain/race/raceFactory'
import { gridPositionsForPlayer } from '@/domain/race/startGrid'
import { nearbyCar as makeCar, nearbyPath as path, nearbyTrack as track } from '../fixtures/nearbyRace'

class NearbyNetwork {
  readonly packets: { from: string; to: string[]; bytes: Uint8Array }[] = []
  private readonly rooms = new Map<string, string>()
  private readonly listeners = new Map<string, (event: NearbyEvent) => void>()
  private readonly pairs = new Map<string, Set<string>>()
  private readonly connections = new Map<string, Set<string>>()

  endpoint(id: string): NearbyTransport {
    return {
      subscribe: (listener) => {
        this.listeners.set(id, listener)
        return () => this.listeners.delete(id)
      },
      host: async (name) => { this.rooms.set(id, name) },
      scan: async () => {
        for (const [host, name] of this.rooms) this.emit(id, { type: 'found', id: host, name })
      },
      connect: async (host) => {
        const pairing = this.key(id, host)
        this.pairs.set(pairing, new Set())
        this.emit(id, { type: 'pairing', id: host })
        this.emit(host, { type: 'pairing', id })
      },
      respond: async (remote, yes) => {
        const key = this.key(id, remote)
        const pair = this.pairs.get(key)
        if (!pair) throw new Error('Unknown pairing')
        if (!yes) {
          this.pairs.delete(key)
          this.emit(remote, { type: 'error', id, message: 'Pairing declined' })
          return
        }
        pair.add(id)
        if (pair.size !== 2) return
        this.pairs.delete(key)
        this.connect(id, remote)
        this.connect(remote, id)
        this.emit(id, { type: 'connected', id: remote })
        this.emit(remote, { type: 'connected', id })
      },
      lock: async () => { this.rooms.delete(id) },
      send: async (ids, bytes) => {
        this.packets.push({ from: id, to: [...ids], bytes })
        for (const remote of ids) {
          if (!this.connections.get(id)?.has(remote)) throw new Error('Unknown connection')
          this.emit(remote, { type: 'packet', id, bytes: new Uint8Array(bytes) })
        }
      },
      stop: async () => {
        this.rooms.delete(id)
        for (const remote of this.connections.get(id) ?? []) {
          this.connections.get(remote)?.delete(id)
          this.emit(remote, { type: 'disconnected', id })
        }
        this.connections.delete(id)
      },
    }
  }

  private connect(id: string, remote: string): void {
    const connections = this.connections.get(id) ?? new Set()
    connections.add(remote)
    this.connections.set(id, connections)
  }

  private key(left: string, right: string) { return [left, right].sort().join('|') }
  private emit(id: string, event: NearbyEvent): void {
    queueMicrotask(() => this.listeners.get(id)?.(event))
  }
}

describe('Nearby Arcade', () => {
  it('shares a track and countdown with three paired guests, and relays ghosts and finishing times', async () => {
    const network = new NearbyNetwork()
    const players = [
      { name: 'host', car: 'blue', clockOffset: 40, identity: { icon: 'crown', color: 'gold' } },
      { name: 'guest-1', car: 'red', clockOffset: 1500, identity: { icon: 'star', color: 'pink' } },
      { name: 'guest-2', car: 'green', clockOffset: 700, identity: { icon: 'bolt', color: 'violet' } },
      { name: 'guest-3', car: 'yellow', clockOffset: 3, identity: { icon: 'diamond', color: 'lime' } },
    ] as const
    let time = 300
    const setups = players.map(({ name, car, clockOffset, identity }) => {
      const device = new NearbyRace(network.endpoint(name), (course) => course.points.length === track.points.length,
        () => time + clockOffset)
      device.setIdentity(identity)
      device.setDisplayName(name === 'host' ? 'JulienQC' : `Racer ${name.slice(-1)}`)
      return { name, car, clockOffset, device }
    })
    const devices = setups.map(({ device }) => device)
    const starts = new Map<string, NearbyStart>()
    const countdowns = new Map<string, number>()
    for (const { name, device } of setups) {
      device.onStart((start) => { starts.set(name, start) })
      device.onCountdown((startsAt) => { countdowns.set(name, startsAt) })
    }
    const [host, red, green, yellow] = devices
    assert(host && red && green && yellow)
    try {
      host.host({ track, laps: 2, lighting: 'night', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })

      for (const [index, { car, device: guest }] of setups.slice(1).entries()) {
        guest.scan(car)
        await vi.waitFor(() => expect(guest.snapshot().rooms).toEqual([['host', host.snapshot().room]]), { interval: 5 })
        guest.connect('host')
        await vi.waitFor(() => {
          expect(guest.snapshot().phase).toBe('waiting')
          expect(host.snapshot().players).toBe(index + 2)
        }, { interval: 5 })
        expect(guest.snapshot()).not.toHaveProperty('pairing')
      }

      host.start()
      await vi.waitFor(() => expect(starts.size).toBe(4), { interval: 5 })
      for (const { name, device, car } of setups) {
        const start = starts.get(name)
        assert(start)
        expect(start).toMatchObject({ laps: 2, lighting: 'night', car })
        expect(start.track.points).toEqual(track.points)
        expect(start.startsAt).toBeUndefined()
        expect(device.standings()).toHaveLength(4)
        expect(device.standings().map(({ identity }) => identity)).toEqual(players.map(({ identity }) => identity))
        expect(device.standings().map(({ name }) => name)).toEqual(['JulienQC', 'Racer 1', 'Racer 2', 'Racer 3'])
        expect(device.snapshot().phase).toBe('staging')
      }

      // The host assigns one physical starting pad to each phone. Every
      // device must create its *local* car at that pad, not all at pole.
      const pads = setups.map(({ name }) => starts.get(name)?.gridSlot)
      expect([...pads].sort()).toEqual([0, 1, 2, 3])
      const spawns = setups.map(({ name, car }) => {
        const pad = starts.get(name)?.gridSlot
        assert(pad !== undefined)
        const staged = createRace({
          path, playerCar: car, difficulty: 'hard', laps: 2,
          gridPositions: gridPositionsForPlayer(pad),
        })
        const local = staged.vehicles[0]
        assert(local)
        return [local.x, local.y].map((coord) => coord.toFixed(3)).join(',')
      })
      expect(new Set(spawns).size).toBe(4)

      // All cars are staged before GO, including the slowest scene.
      for (const { device } of setups.slice(0, 3)) device.sceneReady()
      await vi.waitFor(() => expect(countdowns.size).toBe(0), { interval: 5 })
      yellow.sceneReady()
      await vi.waitFor(() => expect(countdowns.size).toBe(4), { interval: 5 })
      const hostStart = countdowns.get('host')
      assert(hostStart)
      for (const { name, device, clockOffset } of setups) {
        const startsAt = countdowns.get(name)
        assert(startsAt)
        expect(startsAt - clockOffset).toBe(hostStart - players[0].clockOffset)
        expect(device.snapshot().phase).toBe('racing')
      }

      for (const [index, { device, car }] of setups.entries()) {
        device.update(makeCar(car, index * 10, index * 5, index === 1 ? 'bridge' : null))
      }
      // Host sends one newest shared batch for all connected guests.
      await vi.waitFor(() => expect(host.remotePoses()).toHaveLength(3), { interval: 5 })
      time += 1000 / 60
      host.update(makeCar('blue', 0))
      expect(network.packets.filter(({ bytes }) => bytes[0] === Packet.PoseBatch)).toHaveLength(1)
      time += 1000 / 60
      host.update(makeCar('blue', 0))
      await vi.waitFor(() => {
        expect(devices.map((device) => device.remotePoses().length)).toEqual([3, 3, 3, 3])
      }, { interval: 5 })
      expect(yellow.remotePoses()).toContainEqual(expect.objectContaining({ car: 'red', x: 10, z: 5, structureRunId: 'elevated', identity: players[1].identity }))
      const posePackets = network.packets.filter(({ bytes }) => bytes[0] === Packet.Pose)
      const hostBatches = network.packets.filter(({ bytes }) => bytes[0] === Packet.PoseBatch)
      expect(posePackets).toHaveLength(3)
      expect(posePackets.every(({ bytes }) => bytes.byteLength === POSE_BYTES)).toBe(true)
      expect(hostBatches).toHaveLength(2)
      expect(hostBatches.map(({ bytes }) => bytes.byteLength)).toEqual([1 + POSE_BYTES, 1 + 4 * POSE_BYTES])
      expect(hostBatches.every(({ from, to }) => from === 'host' && to.length === 3)).toBe(true)
      expect(decodePoseBatch(hostBatches[1]!.bytes)?.map(({ slot }) => slot)).toEqual([0, 1, 2, 3])

      // Exports identify the actual race roster and packet quality without
      // leaking Nearby connection IDs or requiring packet-level logging.
      const diagnostic = await host.diagnostics()
      expect(diagnostic).toMatchObject({ version: 2, race: {
        round: 0, localSlot: 0,
        track: { id: track.id, name: track.name, lighting: 'night', laps: 2 },
        players: [
          { id: 'slot-0', name: 'JulienQC', car: 'blue', icon: 'crown', color: 'gold', local: true },
          { id: 'slot-1', name: 'Racer 1', car: 'red', icon: 'star', color: 'pink', local: false },
          { id: 'slot-2', name: 'Racer 2', car: 'green', icon: 'bolt', color: 'violet', local: false },
          { id: 'slot-3', name: 'Racer 3', car: 'yellow', icon: 'diamond', color: 'lime', local: false },
        ],
      } })
      const hostDiagnostics = diagnostic.race as { players: { receive: { pose: { accepted: number } } }[] }
      expect(hostDiagnostics.players.slice(1).every(player => player.receive.pose.accepted > 0)).toBe(true)
      expect(JSON.stringify(diagnostic)).not.toMatch(/guest-1|guest-2|guest-3/)

      // Optional progress telemetry distinguishes race progress from pose position.
      const progressState = createRace({ path, playerCar: 'blue', difficulty: 'hard', laps: 2 })
      const progressCars = setups.map(({ car }, index) =>
        ({ ...makeCar(car, index * 10), lap: index === 0 ? 0 : 1 }))
      time += 200
      devices.forEach((device, index) => {
        device.update(progressCars[index]!, progressState)
      })
      await vi.waitFor(() => {
        expect(host.livePosition(progressCars[0]!, progressState)).toMatchObject({ position: 4, vehicleCount: 4 })
        expect(red.livePosition(progressCars[1]!, progressState)).toMatchObject({ position: 1, vehicleCount: 4 })
      }, { interval: 5 })
      const progressCount = network.packets.filter(({ bytes }) => bytes[0] === Packet.Progress).length
      expect(progressCount).toBeGreaterThanOrEqual(4)
      time += 200
      const leadingHost = { ...progressCars[0]!, lap: 1 }
      host.update(leadingHost, progressState)
      await vi.waitFor(() => {
        expect(red.livePosition(progressCars[1]!, progressState)?.position).toBe(2)
        expect(host.livePosition(leadingHost, progressState)?.position).toBe(1)
      }, { interval: 5 })


      red.finish(40.125)
      host.finish(42)
      time += 50
      await vi.waitFor(() => {
        expect(green.standings().slice(0, 2)).toEqual([
          expect.objectContaining({ car: 'red', time: 40.125 }),
          expect.objectContaining({ car: 'blue', time: 42 }),
        ])
      }, { interval: 5 })
      yellow.close()
      await vi.waitFor(() => expect(green.standings().at(-1)).toMatchObject({ car: 'yellow', left: true }), { interval: 5 })
      expect(green.remotePoses()).toEqual([])
      const afterLeave = (await host.diagnostics()).race as { players: { slot: number; left: boolean }[] }
      expect(afterLeave.players.find(player => player.slot === 3)?.left).toBe(true)
      host.close()
      expect((await host.diagnostics()).race).toEqual(afterLeave)
    } finally {
      for (const device of devices) device.destroy()
    }
  })

  it.each([2, 3])('assigns distinct contiguous start pads with %i nearby players', async (count) => {
    const network = new NearbyNetwork()
    const participants = Array.from({ length: count }, (_, index) => ({
      name: index ? `guest-${index}` : 'host',
      device: new NearbyRace(network.endpoint(index ? `guest-${index}` : 'host'), () => true),
    }))
    const starts = new Map<string, NearbyStart>()
    for (const { name, device } of participants) {
      device.onStart((start) => { starts.set(name, start) })
    }
    const host = participants[0]!.device
    try {
      host.host({ track, laps: 1, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      for (const { device } of participants.slice(1)) {
        device.scan('red')
        await vi.waitFor(() => expect(device.snapshot().rooms).toHaveLength(1), { interval: 5 })
        device.connect('host')
        await vi.waitFor(() => expect(device.snapshot().phase).toBe('waiting'), { interval: 5 })
      }
      host.start()
      await vi.waitFor(() => expect(starts.size).toBe(count), { interval: 5 })
      expect([...starts.values()].map(({ gridSlot }) => gridSlot).sort()).toEqual(
        Array.from({ length: count }, (_, index) => index),
      )
    } finally {
      for (const { device } of participants) device.destroy()
    }
  })

  it('runs only local physics and reports results to the room without writing a solo score', () => {
    const nearby = {
      update: vi.fn(),
      remotePoses: () => [{ car: 'red' as const, t: 0, x: 0, y: 0, z: 1, angle: 0, structureRunId: null }],
      recovered: vi.fn(),
      finish: vi.fn(),
    }
    const record = vi.fn(() => true)
    const saveGhost = vi.fn(() => true)
    const race = new RaceSession({
      nearby,
      scoreStore: { forTrack: () => [], record, removeTrack: () => true },
      ghostStore: { load: () => null, record: saveGhost },
      feedback: { unlock() {}, setEnabled() {}, handle() {}, silenceContinuous() {}, destroy() {} },
      random: { next: () => 0.5 },
      step: (state, _input, delta) => {
        const elapsed = state.elapsed + delta
        const finished = elapsed >= 0.1
        const [player] = state.vehicles
        assert(player?.player)
        return {
          state: { ...state, elapsed, phase: finished ? 'finished' : 'running',
            vehicles: [{ ...player, finishedAt: finished ? elapsed : null }] },
          events: [],
        }
      },
    })
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100)
    try {
      race.start(track, { car: 'blue', laps: 1, difficulty: 'hard', mode: 'nearby', handling: 'arcade' })
      expect(race.snapshot().state?.vehicles.map((vehicle) => vehicle.car)).toEqual(['blue'])
      const input = { throttle: 1, braking: false, steering: 0 }
      clock.mockReturnValue(1000)
      race.advance(10, input)
      expect(race.snapshot().state?.phase).toBe('countdown')
      expect(race.snapshot().state?.elapsed).toBe(0)
      race.scheduleNearbyStart(4100)
      expect(race.nearbyGhosts().map(({ car }) => car)).toEqual(['red'])
      clock.mockReturnValue(4050)
      race.advance(0.05, input)
      expect(race.snapshot().state?.phase).toBe('countdown')
      clock.mockReturnValue(4125)
      race.advance(0.075, input)
      expect(race.snapshot().state?.phase).toBe('running')
      race.advance(0.025, input)
      expect(nearby.update).toHaveBeenCalled()
      race.advance(0.2, input)
      expect(nearby.finish).toHaveBeenCalledExactlyOnceWith(race.snapshot().result?.playerTime)
      expect(race.snapshot().result?.playerTime).toBeGreaterThanOrEqual(0.1)
      expect(record).not.toHaveBeenCalled()
      expect(saveGhost).not.toHaveBeenCalled()
    } finally {
      race.destroy()
      clock.mockRestore()
    }
  })


})

describe('Nearby track sharing and rematches', () => {
  it('shares a track without starting a race and waits for explicit save confirmation', async () => {
    const network = new NearbyNetwork()
    const host = new NearbyRace(network.endpoint('sender'), () => true)
    // A draft circuit may be shared even when it is not yet race-ready.
    const recipient = new NearbyRace(network.endpoint('friend'), () => false)
    const racer = new NearbyRace(network.endpoint('racer'), () => true)
    try {
      host.hostShare(track)
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      recipient.scan('blue', 'share')
      racer.scan('red')
      await vi.waitFor(() => expect(recipient.snapshot().rooms).toEqual([['sender', host.snapshot().room]]), { interval: 5 })
      expect(racer.snapshot().rooms).toEqual([])
      recipient.connect('sender')
      await vi.waitFor(() => expect(recipient.snapshot().phase).toBe('share-review'), { interval: 5 })
      expect(recipient.pendingSharedTrack()?.points).toEqual(track.points)
      expect(recipient.snapshot().incomingTrack).toBe(track.name)
      expect(host.snapshot().sharedCount).toBe(0)
      recipient.respondToShare(true)
      await vi.waitFor(() => expect(host.snapshot().sharedCount).toBe(1), { interval: 5 })
      expect(recipient.pendingSharedTrack()).toBeNull()
      expect(recipient.snapshot().phase).toBe('waiting')
      // Duplicate acknowledgements from a peer must not inflate confirmation counts.
      await network.endpoint('friend').send(['sender'],
        new Uint8Array([Packet.Control, ...new TextEncoder().encode(JSON.stringify({ type: 'share-result', status: 'saved' }))]))
      await vi.waitFor(() => expect(host.snapshot().sharedCount).toBe(1), { interval: 5 })
      host.close()
      await vi.waitFor(() => expect(recipient.snapshot().phase).toBe('idle'), { interval: 5 })
      expect(recipient.snapshot().error).toContain('host left')
    } finally {
      host.destroy()
      recipient.destroy()
      racer.destroy()
    }
  })

  it('hosts a configured Nearby Cup, scores every round once and ends after its last track', async () => {
    const network = new NearbyNetwork()
    const host = new NearbyRace(network.endpoint('host'), () => true)
    const guest = new NearbyRace(network.endpoint('guest'), () => true)
    const nextTrack = { ...track, name: 'Final track' }
    const hostStarts: NearbyStart[] = []
    const guestStarts: NearbyStart[] = []
    host.onStart(start => hostStarts.push(start))
    guest.onStart(start => guestStarts.push(start))
    try {
      host.hostCup([track, nextTrack], 'blue', 2)
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      expect(host.snapshot().cup).toMatchObject({ index: 0, total: 2, nextTrack: 'Final track' })
      guest.scan('red')
      await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
      guest.connect('host')
      await vi.waitFor(() => expect(guest.snapshot().phase).toBe('waiting'), { interval: 5 })
      host.start()
      await vi.waitFor(() => expect(guestStarts).toHaveLength(1), { interval: 5 })
      expect(guest.snapshot().cup).toMatchObject({ index: 0, total: 2 })
      host.sceneReady()
      guest.sceneReady()
      await vi.waitFor(() => expect(guest.snapshot().phase).toBe('racing'), { interval: 5 })
      guest.finish(35)
      host.finish(40)
      await vi.waitFor(() => expect(host.snapshot().canRematch).toBe(true), { interval: 5 })
      expect(host.cupStandings()).toEqual([{ slot: 1, points: 10 }, { slot: 0, points: 6 }])
      expect(guest.cupStandings()).toEqual(host.cupStandings())
      expect(host.selectNextTrack(nextTrack)).toBe(false) // Host cannot override the Cup schedule.
      host.start()
      await vi.waitFor(() => {
        expect(hostStarts).toHaveLength(2)
        expect(guestStarts).toHaveLength(2)
      }, { interval: 5 })
      expect(hostStarts[1]?.track.name).toBe('Final track')
      expect(guestStarts[1]?.track.name).toBe('Final track')
      expect(guest.snapshot().cup).toMatchObject({ index: 1, total: 2 })
      host.sceneReady()
      guest.sceneReady()
      await vi.waitFor(() => expect(guest.snapshot().phase).toBe('racing'), { interval: 5 })
      host.finish(32)
      guest.finish(38)
      await vi.waitFor(() => expect(host.cupStandings()).toEqual([
        { slot: 0, points: 16 }, { slot: 1, points: 16 },
      ]), { interval: 5 })
      expect(guest.cupStandings()).toEqual(host.cupStandings())
      expect(host.snapshot().canRematch).toBe(false)
      host.start()
      expect(hostStarts).toHaveLength(2)
    } finally {
      host.destroy()
      guest.destroy()
    }
  })

  it('lets a host race again with a new circuit without reconnecting, rejecting stale round results', async () => {
    const network = new NearbyNetwork()
    const host = new NearbyRace(network.endpoint('host'), () => true)
    const guest = new NearbyRace(network.endpoint('guest'), () => true)
    const hostStarts: NearbyStart[] = []
    const guestStarts: NearbyStart[] = []
    host.onStart(start => hostStarts.push(start))
    guest.onStart(start => guestStarts.push(start))
    try {
      host.host({ track, car: 'blue', laps: 2, lighting: 'day' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      guest.scan('red')
      await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
      guest.connect('host')
      await vi.waitFor(() => expect(guest.snapshot().phase).toBe('waiting'), { interval: 5 })
      host.start()
      await vi.waitFor(() => expect(guestStarts).toHaveLength(1), { interval: 5 })
      host.sceneReady()
      guest.sceneReady()
      await vi.waitFor(() => expect(guest.snapshot().phase).toBe('racing'), { interval: 5 })
      host.finish(43)
      expect(host.snapshot().canRematch).toBe(false)
      guest.finish(41)
      await vi.waitFor(() => expect(host.snapshot().canRematch).toBe(true), { interval: 5 })

      const nextTrack = { ...track, name: 'Changed circuit', raceRevision: track.updatedAt + 1 }
      expect(host.selectNextTrack(nextTrack)).toBe(true)
      expect(host.snapshot().track).toBe('Changed circuit')
      host.start()
      await vi.waitFor(() => {
        expect(hostStarts).toHaveLength(2)
        expect(guestStarts).toHaveLength(2)
      }, { interval: 5 })
      expect(guestStarts[1]?.track.name).toBe('Changed circuit')
      expect(host.snapshot().phase).toBe('staging')
      expect(guest.snapshot().phase).toBe('staging')
      host.sceneReady()
      guest.sceneReady()
      await vi.waitFor(() => expect(guest.snapshot().phase).toBe('racing'), { interval: 5 })
      await network.endpoint('guest').send(['host'],
        new Uint8Array([Packet.Control, ...new TextEncoder().encode(JSON.stringify({ type: 'finish', slot: 1, time: 1, round: 0 }))]))
      await vi.waitFor(() => expect(host.standings().find(racer => !racer.local)?.time).toBeUndefined(), { interval: 5 })
      guest.finish(39)
      host.finish(40)
      await vi.waitFor(() => expect(host.snapshot().canRematch).toBe(true), { interval: 5 })
      guest.close()
      await vi.waitFor(() => expect(host.snapshot().players).toBe(1), { interval: 5 })
    } finally {
      host.destroy()
      guest.destroy()
    }
  })
})

describe('Nearby diagnostics', () => {
  it('keeps bounded, private context after a hosting failure and a native retrieval failure', async () => {
    let listener: ((event: NearbyEvent) => void) | undefined
    const transport: NearbyTransport = {
      subscribe: (next) => { listener = next; return () => undefined },
      host: async () => { throw new Error('secret-room endpoint-123') },
      scan: async () => undefined, connect: async () => undefined, respond: async () => undefined,
      lock: async () => undefined, send: async () => undefined, stop: async () => undefined,
      diagnostics: async () => { throw new Error('native-secret') },
    }
    const race = new NearbyRace(transport, () => true, () => 100)
    race.host({ track, laps: 1, lighting: 'day', car: 'blue' })
    await vi.waitFor(() => expect(race.snapshot().phase).toBe('idle'))
    const report = await race.diagnostics()
    expect(report).toMatchObject({ version: 1, role: 'host', phase: 'idle',
      lastFailure: { source: 'host', phase: 'opening', error: 'Error' }, native: { status: 'failed' } })
    expect(JSON.stringify(report)).not.toContain('secret')
    expect(JSON.stringify(report)).not.toContain('endpoint-123')
    expect(listener).toBeDefined()
  })

  it('bounds the timeline and does not record pairing codes, room names or endpoint IDs', async () => {
    let emit: (event: NearbyEvent) => void = () => undefined
    const transport: NearbyTransport = {
      subscribe: (next) => { emit = next; return () => undefined },
      host: async () => undefined, scan: async () => undefined, connect: async () => undefined,
      respond: async () => undefined, lock: async () => undefined, send: async () => undefined,
      stop: async () => undefined, diagnostics: async () => ({ platform: 'test' }),
    }
    const race = new NearbyRace(transport, () => true)
    race.host({ track, laps: 1, lighting: 'day', car: 'blue' })
    await vi.waitFor(() => expect(race.snapshot().phase).toBe('hosting'))
    for (let i = 0; i < 120; i++) emit({ type: 'pairing', id: 'private-id' })
    const report = await race.diagnostics()
    expect((report.timeline as unknown[]).length).toBeLessThanOrEqual(100)
    expect(report.native).toEqual({ status: 'available', report: { platform: 'test' } })
    expect(JSON.stringify(report)).not.toMatch(/private-id|987654|Room \d{4}/)
  })
})
