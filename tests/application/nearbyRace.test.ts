// @vitest-environment node
import { assert, describe, expect, it, vi } from 'vitest'
import { LOBBY_DELIVERY_TIMEOUT_MS, NearbyRace, type NearbyEvent, type NearbyStart, type NearbyTransport } from '@/application/multiplayer/nearbyRace'
import { decodePoseBatch, Packet, POSE_BYTES } from '@/application/multiplayer/raceWire'
import { decodeControl, encodeControl } from '@/application/multiplayer/controlProtocol'
import { RaceSession } from '@/application/race/raceSession'
import { createRace } from '@/domain/race/raceFactory'
import { gridPositionsForPlayer } from '@/domain/race/startGrid'
import { nearbyCar as makeCar, nearbyPath as path, nearbyTrack as track, nearbyTestSigner } from '../fixtures/nearbyRace'
import { NearbyNetwork } from '../fixtures/nearbyNetwork'

async function readyEveryone(host: NearbyRace, guests: readonly NearbyRace[]): Promise<void> {
  host.start()
  await vi.waitFor(() => {
    expect(host.snapshot().phase).toBe('lobby')
    for (const guest of guests) expect(guest.snapshot().phase).toBe('lobby')
  }, { interval: 5 })
  for (const guest of guests) guest.setLobbyReady(true)
  host.setLobbyReady(true)
}

describe('Nearby Arcade', () => {
  it.each([2, 3])('bounds staging when %i clock replies are unusable', async unavailable => {
    const probes: number[] = []
    const network = new NearbyNetwork((sender, _recipient, bytes) => {
      const message = decodeControl(bytes)
      if (sender === 'guest' && message?.type === 'clock-probe') probes.push(message.probe)
      if (sender === 'host' && message?.type === 'clock-reply' && message.probe < unavailable) {
        // First simulate a missing reply, then a reply with impossible host processing time.
        return message.probe === 0 ? new Uint8Array([255]) :
          encodeControl({ ...message, sentAt: message.receivedAt + 60_000 })
      }
      return bytes
    })
    const host = new NearbyRace(network.endpoint('host'), () => true, () => 40_000)
    const guest = new NearbyRace(network.endpoint('guest'), () => true, () => 10_000)
    const countdown = vi.fn()
    guest.onCountdown(countdown)
    try {
      host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      guest.scan('red')
      await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
      guest.connect('host')
      await vi.waitFor(() => expect(host.snapshot().canStart).toBe(true), { interval: 5 })
      await readyEveryone(host, [guest])
      await vi.waitFor(() => {
        expect(host.snapshot().phase).toBe('staging')
        expect(guest.snapshot().phase).toBe('staging')
      }, { interval: 5 })

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      host.sceneReady()
      guest.sceneReady()
      await vi.advanceTimersByTimeAsync(unavailable * 1000 - 1)
      expect(countdown).not.toHaveBeenCalled()
      expect(guest.snapshot().phase).toBe('staging')
      await vi.advanceTimersByTimeAsync(1)
      expect(probes).toEqual([0, 1, 2, 3, 4])

      if (unavailable === 2) {
        expect(countdown).toHaveBeenCalledExactlyOnceWith(14_000)
        expect(guest.snapshot().phase).toBe('racing')
      } else {
        expect(countdown).not.toHaveBeenCalled()
        expect(guest.snapshot()).toMatchObject({ phase: 'idle', error: expect.stringContaining('synchronize') })
      }
    } finally {
      host.destroy()
      guest.destroy()
      vi.useRealTimers()
    }
  })

  it.each(['roster', 'choice', 'acknowledgement'] as const)('bounds a stalled %s without imposing a deadline on human choice', async kind => {
    let stall = false
    let blocked = false
    let release: (() => void) | undefined
    const delayed = new Promise<void>(resolve => { release = resolve })
    const network = new NearbyNetwork((sender, recipient, bytes) => {
      const message = decodeControl(bytes)
      // Simulate a native send reporting success but never delivering the latest consent.
      return stall && kind === 'acknowledgement' && sender === 'guest' && recipient === 'host' &&
        message?.type === 'ready' && message.accepted ? new Uint8Array([255]) : bytes
    }, async (sender, recipient, bytes) => {
      const message = decodeControl(bytes)
      if (!stall) return
      if ((kind === 'roster' && sender === 'host' && recipient === 'guest' &&
          message?.type === 'lobby' && message.players.every(player => player.accepted)) ||
          (kind === 'choice' && sender === 'guest' && recipient === 'host' &&
          message?.type === 'ready' && message.accepted)) {
        blocked = true
        await delayed
      }
    })
    const host = new NearbyRace(network.endpoint('host'), () => true)
    const guest = new NearbyRace(network.endpoint('guest'), () => true)
    const started = vi.fn()
    host.onStart(started)
    try {
      host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      guest.scan('red')
      await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
      guest.connect('host')
      await vi.waitFor(() => expect(host.snapshot().canStart).toBe(true), { interval: 5 })
      host.start()
      await vi.waitFor(() => expect(guest.snapshot().lobbyPlayers).toHaveLength(2), { interval: 5 })

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(host.snapshot().phase).toBe('lobby')
      expect(guest.snapshot().phase).toBe('lobby')

      stall = true
      guest.setLobbyReady(true)
      if (kind === 'roster') host.setLobbyReady(true)
      await vi.advanceTimersByTimeAsync(0)
      if (kind !== 'acknowledgement') expect(blocked).toBe(true)
      expect(started).not.toHaveBeenCalled()

      if (kind === 'roster') {
        await vi.advanceTimersByTimeAsync(LOBBY_DELIVERY_TIMEOUT_MS + 500)
        expect(host.snapshot()).toMatchObject({ phase: 'idle', error: 'Lobby synchronization timed out. Rejoin the room.' })
        expect((await host.diagnostics()).lastFailure).toMatchObject({ source: 'lobby_roster', error: 'lobby_delivery_timeout' })
      } else {
        await vi.advanceTimersByTimeAsync(kind === 'choice' ? LOBBY_DELIVERY_TIMEOUT_MS : 30_000)
        expect(guest.snapshot().phase).toBe('idle')
        expect(guest.snapshot().error).toContain(kind === 'choice' ? 'synchronization timed out' : 'did not confirm')
      }
      expect(started).not.toHaveBeenCalled()
    } finally {
      host.destroy()
      guest.destroy()
      release?.()
      vi.useRealTimers()
    }
  })

  it('waits for final roster delivery before staging and reconciles a departing ready player', async () => {
    let depart: (() => void) | undefined
    let failed = false
    const network = new NearbyNetwork(undefined, async (sender, recipient, bytes) => {
      const message = decodeControl(bytes)
      if (sender === 'host' && recipient === 'leaver' && message?.type === 'lobby' &&
          message.players.length === 3 && message.players.every(player => player.accepted) && !failed) {
        failed = true
        setTimeout(() => depart?.(), 30)
        throw new Error('Final roster recipient disconnected')
      }
    })
    const host = new NearbyRace(network.endpoint('host'), () => true)
    const guest = new NearbyRace(network.endpoint('guest'), () => true)
    const leaver = new NearbyRace(network.endpoint('leaver'), () => true)
    depart = () => leaver.close()
    const started = vi.fn()
    host.onStart(started)
    try {
      host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      for (const device of [guest, leaver]) {
        device.scan('red')
        await vi.waitFor(() => expect(device.snapshot().rooms).toHaveLength(1), { interval: 5 })
        device.connect('host')
        await vi.waitFor(() => expect(device.snapshot().phase).toBe('waiting'), { interval: 5 })
      }
      await vi.waitFor(() => expect(host.snapshot().players).toBe(3), { interval: 5 })
      await readyEveryone(host, [guest, leaver])
      await vi.waitFor(() => expect(failed).toBe(true), { interval: 5 })
      expect(started).not.toHaveBeenCalled()
      await vi.waitFor(() => {
        expect(host.snapshot().phase).toBe('staging')
        expect(guest.snapshot().phase).toBe('staging')
      }, { interval: 5 })
      expect(host.standings()).toHaveLength(2)
      expect(started).toHaveBeenCalledOnce()
      host.sceneReady()
      guest.sceneReady()
      await vi.waitFor(() => expect(guest.snapshot().phase).toBe('racing'), { interval: 5 })
    } finally {
      host.destroy()
      guest.destroy()
      leaver.destroy()
    }
  })

  it.each(['superseded', 'current'] as const)('handles a late %s readiness delivery failure', async kind => {
    let rejectChoice: (reason: Error) => void = () => { throw new Error('Choice not sent') }
    const delayed = new Promise<void>((_resolve, reject) => { rejectChoice = reject })
    let pending = false
    const network = new NearbyNetwork(undefined, async (sender, recipient, bytes) => {
      const message = decodeControl(bytes)
      if (sender === 'guest' && recipient === 'host' && message?.type === 'ready' && message.choice === 1) {
        pending = true
        await delayed
      }
    })
    const host = new NearbyRace(network.endpoint('host'), () => true)
    const guest = new NearbyRace(network.endpoint('guest'), () => true)
    try {
      host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      guest.scan('red')
      await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
      guest.connect('host')
      await vi.waitFor(() => expect(host.snapshot().canStart).toBe(true), { interval: 5 })
      host.start()
      await vi.waitFor(() => expect(guest.snapshot().lobbyPlayers).toHaveLength(2), { interval: 5 })
      guest.selectLobbyCar('yellow')
      await vi.waitFor(() => expect(pending).toBe(true), { interval: 5 })
      if (kind === 'superseded') {
        guest.selectLobbyCar('green')
        await vi.waitFor(() => expect(guest.snapshot().lobbyPlayers.find(player => player.slot === 1)?.car).toBe('green'), { interval: 5 })
      }
      rejectChoice(new Error('Delayed native failure'))
      if (kind === 'current') {
        await vi.waitFor(() => expect(guest.snapshot().phase).toBe('idle'), { interval: 5 })
        expect(guest.snapshot().error).toContain('message could not be sent')
      } else {
        await vi.waitFor(async () => {
          const report = await guest.diagnostics()
          expect(report.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ event: 'lobby_choice_delivery_obsolete' })]))
        }, { interval: 5 })
        expect(guest.snapshot()).toMatchObject({ phase: 'lobby', localCar: 'green', error: null })
        guest.setLobbyReady(true)
        host.setLobbyReady(true)
        await vi.waitFor(() => expect(guest.snapshot().phase).toBe('staging'), { interval: 5 })
      }
    } finally {
      host.destroy()
      guest.destroy()
    }
  })

  it.each(['roster', 'track'] as const)('keeps remaining players when a %s send fails before the disconnect event', async kind => {
    let depart: (() => void) | undefined
    let triggered = false
    const network = new NearbyNetwork(undefined, async (sender, recipient, bytes) => {
      const target = kind === 'track' ? bytes[0] === Packet.Track : decodeControl(bytes)?.type === 'lobby'
      if (sender === 'host' && recipient === 'leaver' && target && !triggered) {
        triggered = true
        // Native rejects the pending send before delivering onDisconnected.
        setTimeout(() => depart?.(), 15)
        throw new Error('Peer disconnected during delivery')
      }
    })
    const host = new NearbyRace(network.endpoint('host'), () => true)
    const guest = new NearbyRace(network.endpoint('guest'), () => true)
    const leaver = new NearbyRace(network.endpoint('leaver'), () => true)
    depart = () => leaver.close()
    const started = vi.fn()
    host.onStart(started)
    try {
      host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      for (const device of [guest, leaver]) {
        device.scan('red')
        await vi.waitFor(() => expect(device.snapshot().rooms).toHaveLength(1), { interval: 5 })
        device.connect('host')
        await vi.waitFor(() => expect(device.snapshot().phase).toBe('waiting'), { interval: 5 })
      }
      await vi.waitFor(() => expect(host.snapshot().players).toBe(3), { interval: 5 })
      host.start()
      await vi.waitFor(() => {
        expect(triggered).toBe(true)
        expect(host.snapshot().players).toBe(2)
        expect(guest.snapshot().lobbyPlayers).toHaveLength(2)
      }, { interval: 5 })
      expect(host.snapshot().error).toBeNull()
      host.setLobbyReady(true)
      guest.setLobbyReady(true)
      await vi.waitFor(() => expect(started).toHaveBeenCalledOnce(), { interval: 5 })
      host.sceneReady()
      guest.sceneReady()
      await vi.waitFor(() => expect(guest.snapshot().phase).toBe('racing'), { interval: 5 })
      expect(host.standings()).toHaveLength(2)
    } finally {
      host.destroy()
      guest.destroy()
      leaver.destroy()
    }
  })

  it('reports a genuine reliable delivery error when the peer remains connected', async () => {
    const network = new NearbyNetwork(undefined, async (sender, recipient, bytes) => {
      if (sender === 'host' && recipient === 'guest' && bytes[0] === Packet.Track) throw new Error('Track delivery failed')
    })
    const host = new NearbyRace(network.endpoint('host'), () => true)
    const guest = new NearbyRace(network.endpoint('guest'), () => true)
    try {
      host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      guest.scan('red')
      await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
      guest.connect('host')
      await vi.waitFor(() => expect(host.snapshot().canStart).toBe(true), { interval: 5 })
      host.start()
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('idle'), { interval: 5, timeout: 2000 })
      expect(host.snapshot().error).toContain('Track delivery failed')
      expect((await host.diagnostics()).lastFailure).toMatchObject({ source: 'prepare' })
    } finally {
      host.destroy()
      guest.destroy()
    }
  })

  it('requires consent every round, permits car changes and rejects stale readiness', async () => {
    const network = new NearbyNetwork()
    const host = new NearbyRace(network.endpoint('host'), () => true)
    const guest = new NearbyRace(network.endpoint('guest'), () => true)
    const hostStarts: NearbyStart[] = []
    const guestStarts: NearbyStart[] = []
    host.onStart(start => hostStarts.push(start))
    guest.onStart(start => guestStarts.push(start))
    try {
      host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      guest.scan('red')
      await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
      guest.connect('host')
      await vi.waitFor(() => expect(host.snapshot().canStart).toBe(true), { interval: 5 })
      host.start()
      await vi.waitFor(() => expect(guest.snapshot().lobbyPlayers).toHaveLength(2), { interval: 5 })
      host.selectLobbyCar('green')
      guest.selectLobbyCar('yellow')
      guest.setLobbyReady(true)
      expect(guest.snapshot().readyPending).toBe(true)
      await vi.waitFor(() => {
        expect(host.snapshot().lobbyPlayers.find(p => p.slot === 1)?.accepted).toBe(true)
        expect(guest.snapshot().readyPending).toBe(false)
      }, { interval: 5 })
      guest.selectLobbyCar('red')
      expect(guest.snapshot().localCar).toBe('yellow')
      expect(hostStarts).toHaveLength(0)
      guest.setLobbyReady(false)
      await vi.waitFor(() => expect(guest.snapshot().unlockPending).toBe(false), { interval: 5 })
      guest.selectLobbyCar('blue')
      host.setLobbyReady(true)
      host.selectLobbyCar('red')
      expect(host.snapshot()).toMatchObject({ localCar: 'green', localReady: true, readyPending: false })
      host.setLobbyReady(false)
      host.selectLobbyCar('red')
      expect(host.snapshot()).toMatchObject({ localCar: 'red', localReady: false })
      host.selectLobbyCar('green')
      host.setLobbyReady(true)
      expect(hostStarts).toHaveLength(0)
      guest.setLobbyReady(true)
      await vi.waitFor(() => expect(guestStarts).toHaveLength(1), { interval: 5 })
      expect(hostStarts[0]?.car).toBe('green')
      expect(guestStarts[0]?.car).toBe('blue')
      host.sceneReady()
      guest.sceneReady()
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('racing'), { interval: 5 })
      host.finish(40)
      guest.finish(39)
      await vi.waitFor(() => expect(host.snapshot().canRematch).toBe(true), { interval: 5 })
      host.start()
      await vi.waitFor(() => expect(guest.snapshot().lobbyPlayers).toHaveLength(2), { interval: 5 })
      expect(host.snapshot()).toMatchObject({ localCar: 'green', localReady: false })
      expect(guest.snapshot()).toMatchObject({ localCar: 'blue', localReady: false })
      const oldConsent = network.packets.find(p => {
        const control = decodeControl(p.bytes)
        return p.from === 'guest' && control?.type === 'ready' && control.accepted
      })
      assert(oldConsent)
      await network.endpoint('guest').send(['host'], oldConsent.bytes)
      host.setLobbyReady(true)
      expect(hostStarts).toHaveLength(1)
      guest.selectLobbyCar('red')
      guest.setLobbyReady(true)
      await vi.waitFor(() => expect(guestStarts).toHaveLength(2), { interval: 5 })
      expect(guestStarts[1]?.car).toBe('red')
    } finally {
      host.destroy()
      guest.destroy()
    }
  })

  it('lets the host configure lighting and laps for a Cup session without changing saved tracks', async () => {
    const network = new NearbyNetwork()
    const host = new NearbyRace(network.endpoint('host'), () => true)
    const guest = new NearbyRace(network.endpoint('guest'), () => true)
    const hostStarts: NearbyStart[] = []
    const guestStarts: NearbyStart[] = []
    host.onStart(start => hostStarts.push(start))
    guest.onStart(start => guestStarts.push(start))
    const first = { ...track, lighting: 'day' as const }
    const next = { ...track, name: 'Next round', lighting: 'day' as const }
    try {
      expect(host.setLighting('night')).toBe(false)
      expect(host.setLaps(3)).toBe(false)
      host.hostCup([first, next], 'blue', 2)
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      expect(host.snapshot().lighting).toBe('day')
      expect(host.snapshot().configurableLaps).toBe(2)
      expect(host.setLaps(3)).toBe(true)
      expect(host.snapshot().configurableLaps).toBe(3)
      expect(host.setLighting('night')).toBe(true)
      expect(host.snapshot().lighting).toBe('night')
      expect(first.lighting).toBe('day')
      guest.scan('red')
      await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
      guest.connect('host')
      await vi.waitFor(() => expect(guest.snapshot().phase).toBe('waiting'), { interval: 5 })
      expect(guest.setLighting('day')).toBe(false)
      expect(guest.setLaps(1)).toBe(false)
      await readyEveryone(host, [guest])
      await vi.waitFor(() => expect(hostStarts).toHaveLength(1), { interval: 5 })
      expect(hostStarts[0]?.lighting).toBe('night')
      expect(guestStarts[0]?.lighting).toBe('night')
      expect(hostStarts[0]?.laps).toBe(3)
      expect(guestStarts[0]?.laps).toBe(3)
      expect(host.setLaps(1)).toBe(false)
      host.sceneReady()
      guest.sceneReady()
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('racing'), { interval: 5 })
      host.finish(40)
      guest.finish(38)
      await vi.waitFor(() => expect(host.snapshot().canRematch).toBe(true), { interval: 5 })
      await readyEveryone(host, [guest])
      await vi.waitFor(() => expect(guestStarts).toHaveLength(2), { interval: 5 })
      expect(hostStarts[1]?.lighting).toBe('night')
      expect(guestStarts[1]?.lighting).toBe('night')
      expect(hostStarts[1]?.laps).toBe(3)
      expect(guestStarts[1]?.laps).toBe(3)
      expect(next.lighting).toBe('day')
    } finally {
      host.destroy()
      guest.destroy()
    }
  })

  it('stages eight peers with distinct pads and multicasts one eight-car pose batch', async () => {
    const network = new NearbyNetwork()
    const devices = Array.from({ length: 8 }, (_, index) => new NearbyRace(
      network.endpoint(index === 0 ? 'host' : `guest-${index}`),
      () => true,
    ))
    const host = devices[0]!
    const starts = new Map<number, NearbyStart>()
    const car = ['blue', 'red', 'green', 'yellow'] as const
    devices.forEach((device, index) => { device.onStart(start => { starts.set(index, start) }) })
    try {
      host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      for (let index = 1; index < devices.length; index++) {
        const guest = devices[index]!
        guest.scan(car[index % car.length]!)
        await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
        guest.connect('host')
        await vi.waitFor(() => {
          expect(guest.snapshot().phase).toBe('waiting')
          expect(host.snapshot().players).toBe(index + 1)
        }, { interval: 5 })
      }
      expect(host.snapshot().players).toBe(8)
      await readyEveryone(host, devices.slice(1))
      await vi.waitFor(() => expect(starts.size).toBe(8), { interval: 5 })
      expect([...starts.values()].map(start => start.gridSlot).sort((a,b)=>a-b))
        .toEqual([0,1,2,3,4,5,6,7])
      const locations = [...starts.entries()].map(([index, start]) => {
        expect(devices[index]!.standings()).toHaveLength(8)
        const stage = createRace({
          path, laps: 2, difficulty: 'normal', playerCar: car[index % car.length]!,
          gridPositions: gridPositionsForPlayer(start.gridSlot),
        })
        expect(stage.vehicles).toHaveLength(4)
        const player = stage.vehicles[0]!
        return [player.x, player.y].map(v => v.toFixed(2)).join(',')
      })
      expect(new Set(locations).size).toBe(8)
      devices.forEach(device => { device.sceneReady() })
      await vi.waitFor(() => expect(devices.every(device => device.snapshot().phase === 'racing')).toBe(true), { interval: 5 })
      const posePackets = devices.map((_, index) => {
        const stage = createRace({
          path, laps: 2, difficulty: 'normal', playerCar: car[index % car.length]!,
          gridPositions: gridPositionsForPlayer(starts.get(index)!.gridSlot),
        })
        return stage.vehicles[0]!
      })
      for (let index = 1; index < devices.length; index++) devices[index]!.update(posePackets[index]!)
      await vi.waitFor(() => expect(host.diagnostics()).resolves.toMatchObject({ poseCounts: { received: 7 } }), { interval: 5 })
      host.update(posePackets[0]!)
      await vi.waitFor(() => {
        const broadcasts = network.packets.filter(msg => msg.from === 'host' && msg.bytes[0] === Packet.PoseBatch)
        expect(broadcasts).toHaveLength(1)
        expect(broadcasts[0]?.to).toHaveLength(7)
        expect(decodePoseBatch(broadcasts[0]!.bytes)).toHaveLength(8)
      }, { interval: 5 })
    } finally {
      devices.forEach(device => { device.destroy() })
    }
  })

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

      await readyEveryone(host, devices.slice(1))
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

      for (const { device } of setups) expect(device.synchronizedElapsed()).toBe(0)
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
      expect(decodePoseBatch(hostBatches[1]!.bytes)?.map(({ sampleTimeMs }) => sampleTimeMs)).toEqual([-3967, -4000, -4000, -4000])

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
        expect(new Set(setups.map(({ device }, index) => device.livePosition(progressCars[index]!, progressState)?.position)).size).toBe(4)
      }, { interval: 5 })


      const withTrace = await host.diagnostics()
      const trace = (withTrace.race as { trace: {
        frames: { local: { slot: number }; rivals: { slot: number; visible: boolean }[] }[]
      } }).trace
      expect(trace.frames.length).toBeGreaterThan(0)
      expect(trace.frames.at(-1)?.local.slot).toBe(0)
      expect(trace.frames.at(-1)?.rivals.filter(rival => rival.visible)).toHaveLength(3)
      expect(JSON.stringify(trace)).not.toMatch(/guest-1|guest-2|guest-3/)

      time += 20_000
      red.update(progressCars[1]!, progressState)
      await vi.waitFor(async () => expect(await red.diagnostics()).toMatchObject({
        synchronization: { clockAudit: { offsetDriftMs: 0, roundTripMs: 0 }, clockAuditFailures: 0 },
      }), { interval: 5 })
      expect(red.synchronizedElapsed()).toBeCloseTo(host.synchronizedElapsed()!)
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

  it.each(['host', 'guest'] as const)(
    'rejects a legacy %s before starting a race with an actionable update message',
    async legacy => {
      // An older APK parses unknown JSON keys but omits protocolVersion from
      // its own control messages. Strip just that field at its send boundary.
      const network = new NearbyNetwork((sender, _recipient, bytes) => {
        if (sender !== legacy) return bytes
        const control = decodeControl(bytes)
        if (!control || (control.type !== 'prepare' && control.type !== 'ready')) return bytes
        const packet = { ...control }
        delete packet.protocolVersion
        return encodeControl(packet)
      })
      const host = new NearbyRace(network.endpoint('host'), () => true)
      const guest = new NearbyRace(network.endpoint('guest'), () => true)
      const startHost = vi.fn()
      const startGuest = vi.fn()
      host.onStart(startHost)
      guest.onStart(startGuest)
      try {
        host.host({ track, laps: 2, lighting: 'day', car: 'blue' })
        await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
        guest.scan('red')
        await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
        guest.connect('host')
        await vi.waitFor(() => expect(guest.snapshot().phase).toBe('waiting'), { interval: 5 })
        host.start()
        const rejectingDevice = legacy === 'host' ? guest : host
        await vi.waitFor(() => {
          expect(rejectingDevice.snapshot().phase).toBe('idle')
          expect(rejectingDevice.snapshot().error).toContain('Update Track Forge')
        }, { interval: 5 })
        expect(startHost).not.toHaveBeenCalled()
        expect(startGuest).not.toHaveBeenCalled()
      } finally {
        host.destroy()
        guest.destroy()
      }
    },
  )

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
      await readyEveryone(host, participants.slice(1).map(({ device }) => device))
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
      captureFinalFrame: vi.fn(),
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
      race.start(track, { car: 'blue', laps: 1, difficulty: 'hard', mode: 'nearby' })
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
      expect(nearby.captureFinalFrame).toHaveBeenCalledOnce()
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
  it('keeps sharing capped at three connected guests when racing supports eight', async () => {
    const network = new NearbyNetwork()
    const host = new NearbyRace(network.endpoint('host'), () => true, undefined, nearbyTestSigner())
    const guests = Array.from({ length: 4 }, (_, index) =>
      new NearbyRace(network.endpoint(`guest-${index}`), () => true))
    try {
      host.hostShare(track)
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      for (const [index, guest] of guests.entries()) {
        guest.scan('blue', 'share')
        await vi.waitFor(() => expect(guest.snapshot().rooms).toHaveLength(1), { interval: 5 })
        guest.connect('host')
        if (index < 3) {
          await vi.waitFor(() => expect(host.snapshot().players).toBe(index + 2), { interval: 5 })
          await vi.waitFor(() => expect(guest.snapshot().phase).toBe('share-review'), { interval: 5 })
        } else {
          await vi.waitFor(() => expect(guest.snapshot().phase).toBe('idle'), { interval: 5 })
          expect(guest.snapshot().error).toContain('Pairing declined')
          expect(host.snapshot().players).toBe(4)
        }
      }
    } finally {
      host.destroy()
      guests.forEach(guest => { guest.destroy() })
    }
  })

  it('shares a track without starting a race and waits for explicit save confirmation', async () => {
    const network = new NearbyNetwork()
    const host = new NearbyRace(network.endpoint('sender'), () => true, undefined, nearbyTestSigner())
    // A draft circuit may be shared even when it is not yet race-ready.
    const recipient = new NearbyRace(network.endpoint('friend'), () => false)
    const racer = new NearbyRace(network.endpoint('racer'), () => true)
    try {
      const challenge = { car: 'blue' as const, laps: 1 as const, time: 31.5, frames: [
        { t: 0, x: 0, y: 0, angle: 0, z: 0, structureRunId: null },
        { t: 31.5, x: 1, y: 1, angle: 0, z: 0, structureRunId: null },
      ] }
      host.hostShare(track, challenge)
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'), { interval: 5 })
      recipient.scan('blue', 'share')
      racer.scan('red')
      await vi.waitFor(() => expect(recipient.snapshot().rooms).toEqual([['sender', host.snapshot().room]]), { interval: 5 })
      expect(racer.snapshot().rooms).toEqual([])
      recipient.connect('sender')
      await vi.waitFor(() => expect(recipient.snapshot().phase).toBe('share-review'), { interval: 5 })
      expect(recipient.pendingSharedTrack()?.points).toEqual(track.points)
      expect(recipient.pendingSharedTrack()?.signedSource).toBeTypeOf('string')
      expect(recipient.pendingSharedTrack()?.creatorChallenge).toEqual(challenge)
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
      await readyEveryone(host, [guest])
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
      await vi.waitFor(() => expect(guest.snapshot().lobbyPlayers).toHaveLength(2), { interval: 5 })
      expect(host.snapshot()).toMatchObject({ localCar: 'blue', localReady: false })
      expect(guest.snapshot()).toMatchObject({ localCar: 'red', localReady: false })
      host.selectLobbyCar('yellow')
      guest.selectLobbyCar('green')
      host.setLobbyReady(true)
      expect(hostStarts).toHaveLength(1)
      guest.setLobbyReady(true)
      await vi.waitFor(() => {
        expect(hostStarts).toHaveLength(2)
        expect(guestStarts).toHaveLength(2)
      }, { interval: 5 })
      expect(hostStarts[1]?.track.name).toBe('Final track')
      expect(guestStarts[1]?.track.name).toBe('Final track')
      expect(hostStarts[1]?.car).toBe('yellow')
      expect(guestStarts[1]?.car).toBe('green')
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
      await readyEveryone(host, [guest])
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
      await readyEveryone(host, [guest])
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
    expect(report).toMatchObject({ version: 2, role: 'host', phase: 'idle',
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
