// @vitest-environment node
import { assert, describe, expect, it, vi } from 'vitest'
import { NearbyRace, type NearbyEvent, type NearbyStart, type NearbyTransport } from '@/application/multiplayer/nearbyRace'
import { decodePose, encodePose, Packet, POSE_BYTES, RemoteGhost } from '@/application/multiplayer/raceWire'
import { packTrack, TrackReceiver } from '@/application/multiplayer/trackTransfer'
import { RaceSession } from '@/application/race/raceSession'
import { decodeTrack } from '@/domain/track/trackCodec'
import { createRace } from '@/domain/race/raceFactory'
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
        this.emit(id, { type: 'pairing', id: host, code: '1234' })
        this.emit(host, { type: 'pairing', id, code: '1234' })
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
      { name: 'host', car: 'blue', clockOffset: 40 },
      { name: 'guest-1', car: 'red', clockOffset: 1500 },
      { name: 'guest-2', car: 'green', clockOffset: 700 },
      { name: 'guest-3', car: 'yellow', clockOffset: 3 },
    ] as const
    let time = 300
    const setups = players.map(({ name, car, clockOffset }) => {
      const device = new NearbyRace(network.endpoint(name), (course) => course.points.length === track.points.length,
        () => time + clockOffset)
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

      for (const [index, { name: id, car, device: guest }] of setups.slice(1).entries()) {
        guest.scan(car)
        await vi.waitFor(() => expect(guest.snapshot().rooms).toEqual([['host', host.snapshot().room]]), { interval: 5 })
        guest.connect('host')
        await vi.waitFor(() => {
          expect(guest.snapshot().pairing).toEqual([['host', '1234']])
          expect(host.snapshot().pairing).toEqual([[id, '1234']])
          expect(host.snapshot().canStart).toBe(false)
        }, { interval: 5 })
        host.respond(id, true)
        guest.respond('host', true)
        await vi.waitFor(() => {
          expect(guest.snapshot().phase).toBe('waiting')
          expect(host.snapshot().players).toBe(index + 2)
        }, { interval: 5 })
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
        expect(device.snapshot().phase).toBe('staging')
      }

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
      await vi.waitFor(() => {
        expect(devices.map((device) => device.remotePoses().length)).toEqual([3, 3, 3, 3])
      }, { interval: 5 })
      expect(yellow.remotePoses()).toContainEqual(expect.objectContaining({ car: 'red', x: 10, z: 5, structureRunId: 'elevated' }))
      const posePackets = network.packets.filter(({ bytes }) => bytes[0] === Packet.Pose)
      expect(posePackets).toHaveLength(7)
      expect(posePackets.every(({ bytes }) => bytes.byteLength === POSE_BYTES)).toBe(true)

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
    for (let i = 0; i < 120; i++) emit({ type: 'pairing', id: 'private-id', code: '987654' })
    const report = await race.diagnostics()
    expect((report.timeline as unknown[]).length).toBeLessThanOrEqual(100)
    expect(report.native).toEqual({ status: 'available', report: { platform: 'test' } })
    expect(JSON.stringify(report)).not.toMatch(/private-id|987654|Room \d{4}/)
  })
})
