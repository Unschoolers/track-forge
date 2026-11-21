import { describe, expect, it } from 'vitest'
import {
  decodeControl, encodeControl, MAX_PLAYERS, validLineupPositions,
  type Control,
} from '@/application/multiplayer/controlProtocol'
import { Packet } from '@/application/multiplayer/raceWire'
import { DEFAULT_PLAYER_IDENTITY } from '@/application/multiplayer/playerIdentity'

const identity = DEFAULT_PLAYER_IDENTITY
function packet(value: unknown): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(value))
  const bytes = new Uint8Array(text.length + 1)
  bytes[0] = Packet.Control
  bytes.set(text, 1)
  return bytes
}

describe('nearby reliable control protocol', () => {
  it('roundtrips each bounded control variant with its wire discriminator', () => {
    const messages: Control[] = [
      { type: 'prepare', slot: 1, laps: 3, lighting: 'night' },
      { type: 'ready', car: 'green', identity },
      { type: 'lineup', cars: ['red', 'green', null, null],
        identities: [identity, identity, null, null], positions: [1, 0, null, null] },
      { type: 'armed' },
      { type: 'start', cars: ['red', 'green', null, null], delay: 1500, readyAge: 300 },
      { type: 'finish', slot: 0, time: 75.4 },
      { type: 'left', slot: 1 },
    ]
    expect(MAX_PLAYERS).toBe(4)
    for (const message of messages) {
      const bytes = encodeControl(message)
      expect(bytes[0]).toBe(Packet.Control)
      expect(decodeControl(bytes)).toEqual(message)
    }
  })

  it('rejects malformed, oversized and wrong-type packets without throwing', () => {
    expect(decodeControl(new Uint8Array())).toBeNull()
    expect(decodeControl(new Uint8Array([Packet.Control]))).toBeNull()
    expect(decodeControl(new Uint8Array([Packet.Pose, 123]))).toBeNull()
    expect(decodeControl(new Uint8Array([Packet.Control, 123]))).toBeNull()
    expect(decodeControl(new Uint8Array(513))).toBeNull()
    expect(decodeControl(packet(null))).toBeNull()
    expect(decodeControl(packet(['armed']))).toBeNull()
    expect(decodeControl(packet({ type: 'unknown' }))).toBeNull()
  })

  it('exchanges bounded profile names in reliable lobby messages and supports older peers', () => {
    const ready: Control = { type: 'ready', car: 'green', identity, name: "Émile QC" }
    const lineup: Control = {
      type: 'lineup', cars: ['blue', 'green', null, null],
      identities: [identity, identity, null, null], positions: [1, 0, null, null],
      names: ['JulienQC', 'Émile QC', null, null],
    }
    expect(decodeControl(encodeControl(ready))).toEqual(ready)
    expect(decodeControl(encodeControl(lineup))).toEqual(lineup)
    // Legacy frames without names still decode for mixed-version rooms.
    expect(decodeControl(packet({ type: 'ready', car: 'green', identity })))
      .toEqual({ type: 'ready', car: 'green', identity })
    for (const name of ['', 'A', 'a'.repeat(25), '<img onerror=alert(1)>', 12]) {
      expect(decodeControl(packet({ ...ready, name })), JSON.stringify(name)).toBeNull()
    }
    for (const names of [
      ['JulienQC'], ['JulienQC', 'Buddy', 'Injected', null],
      ['JulienQC', null, 'Other', null], ['JulienQC', 'a'.repeat(25), null, null],
      ['JulienQC', {}, null, null],
    ]) expect(decodeControl(packet({ ...lineup, names })), JSON.stringify(names)).toBeNull()
    expect(decodeControl(new Uint8Array(1025).fill(0))).toBeNull()
  })

  it('rejects duplicate, missing or out-of-range multiplayer spawn assignments', () => {
    const base = { type: 'lineup', cars: ['red', 'green', null, null],
      identities: [identity, identity, null, null], positions: [1, 0, null, null] }
    expect(validLineupPositions(['red', 'green', null, null], [1, 0, null, null])).toBe(true)
    for (const positions of [
      [0, 0, null, null], [0, 2, null, null], [0, 1, 2, null],
      [0, null, null, null], [0, 1, null],
    ]) {
      expect(decodeControl(packet({ ...base, positions })), JSON.stringify(positions)).toBeNull()
    }
    expect(decodeControl(packet({ ...base, identities: [identity, null, null, null] }))).toBeNull()
    expect(decodeControl(packet({ ...base, cars: ['red', 'green', null] }))).toBeNull()
    expect(decodeControl(packet({ ...base, identities: [identity, { icon: 'fake', color: 'cyan' }, null, null] }))).toBeNull()
  })

  it('rejects invalid participant slots, countdown bounds and finish times', () => {
    const invalid = [
      { type: 'prepare', slot: 0, laps: 1, lighting: 'day' },
      { type: 'prepare', slot: 1, laps: 6, lighting: 'day' },
      { type: 'prepare', slot: 1, laps: 1, lighting: 'storm' },
      { type: 'left', slot: 4 },
      { type: 'finish', slot: -1, time: 10 },
      { type: 'finish', slot: 2, time: 0 },
      { type: 'finish', slot: 2, time: 86400 },
      { type: 'ready', car: 'purple', identity },
      { type: 'start', cars: ['red', 'green', null, null], delay: 6000, readyAge: 100 },
      { type: 'start', cars: ['red', 'green', null, null], delay: 100, readyAge: -1 },
    ]
    for (const message of invalid) {
      expect(decodeControl(packet(message)), JSON.stringify(message)).toBeNull()
    }
  })
})
