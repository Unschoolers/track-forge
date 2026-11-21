// @vitest-environment node
import { assert, describe, expect, it, vi } from 'vitest'
import { NearbyRace, type NearbyEvent, type NearbyStart, type NearbyTransport } from '@/application/multiplayer/nearbyRace'
import { decodePose, decodePoseBatch, encodePose, encodePoseBatch, Packet, POSE_BYTES, POSE_FAST_PERIOD_MS, POSE_PERIOD_MS, RemoteGhost } from '@/application/multiplayer/raceWire'
import { packTrack, TrackReceiver } from '@/application/multiplayer/trackTransfer'
import { RaceSession } from '@/application/race/raceSession'
import { decodeTrack } from '@/domain/track/trackCodec'
import { createRace } from '@/domain/race/raceFactory'
import { gridPositionsForPlayer } from '@/domain/race/startGrid'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import type { CarId, Track } from '@/domain/model'
import trackExport from '../fixtures/figureEight.trackforge.json'

const track = decodeTrack(trackExport, 1)
if (!track) throw new Error('Invalid Figure eight fixture')
const path = new TrackGeometryService().get(track).path

function makeCar(car: CarId, x: number, z = 0, structureRunId: string | null = null) {
  const vehicle = createRace({ path, playerCar: car, difficulty: 'hard', laps: 1 }).vehicles.find((vehicle) => vehicle.player)
  assert(vehicle, 'Expected a player vehicle')
  return { ...vehicle, x, y: -3.25, z, angle: 2 * Math.PI - 0.01, structureRunId }
}

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
      // Host waits for its next tick, then broadcasts all four cars once.
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
