import { describe, expect, it } from 'vitest'
import { decodeControl, encodeControl, MAX_PLAYERS, NEARBY_WIRE_PROTOCOL_VERSION, validLineupPositions, type Control } from '@/application/multiplayer/controlProtocol'
import { Packet } from '@/application/multiplayer/raceWire'
import { DEFAULT_PLAYER_IDENTITY as identity } from '@/application/multiplayer/playerIdentity'

function packet(value: unknown): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  return new Uint8Array([Packet.Control, ...encoded])
}

const cars = ['blue', 'red', 'green', 'yellow', 'blue', 'red', 'green', 'yellow'] as const
const identities = Array.from({ length: MAX_PLAYERS }, () => identity)
const names = Array.from({ length: MAX_PLAYERS }, (_, i) => `Player ${i + 1}`)
const positions = [7, 0, 6, 1, 5, 2, 4, 3]
const lineup: Control = { type: 'lineup', cars: [...cars], identities, names, positions }

describe('nearby eight-player control protocol', () => {
  it('round-trips an eight-player lobby and validates unique starting positions', () => {
    expect(MAX_PLAYERS).toBe(8)
    expect(NEARBY_WIRE_PROTOCOL_VERSION).toBe(3)
    expect(validLineupPositions(cars, positions)).toBe(true)
    expect(decodeControl(encodeControl(lineup))).toEqual(lineup)
    expect(decodeControl(packet({ ...lineup, positions: [0, 0, 2, 3, 4, 5, 6, 7] }))).toBeNull()
    expect(decodeControl(packet({ ...lineup, positions: [0, 1, 2, 3] }))).toBeNull()
    expect(decodeControl(packet({ ...lineup, identities: [identity] }))).toBeNull()
    expect(decodeControl(packet({ ...lineup, names: [...names.slice(0, 7), '<img>'] }))).toBeNull()
  })

  it('accepts eight maximum-length Unicode player names without silently dropping the lineup', () => {
    const international: Control = {
      type: 'lineup',
      cars: Array.from({ length: MAX_PLAYERS }, () => 'yellow' as const),
      identities: Array.from({ length: MAX_PLAYERS }, () => ({ icon: 'diamond' as const, color: 'violet' as const })),
      positions: [...positions],
      names: Array.from({ length: MAX_PLAYERS }, () => '界'.repeat(24)),
    }
    const bytes = encodeControl(international)
    expect(bytes.length).toBeGreaterThan(900)
    expect(bytes.length).toBeLessThanOrEqual(2048)
    expect(decodeControl(bytes)).toEqual(international)
    expect(() => encodeControl({
      ...international,
      names: Array.from({ length: MAX_PLAYERS }, () => '界'.repeat(100)),
    })).toThrow(RangeError)
  })

  it('supports partially occupied eight-slot rooms and never assigns an absent player a pad', () => {
    const empty = Array.from({ length: MAX_PLAYERS }, (_, index) => index < 2 ? cars[index]! : null)
    const ids = Array.from({ length: MAX_PLAYERS }, (_, index) => index < 2 ? identity : null)
    const places = Array.from({ length: MAX_PLAYERS }, (_, index) => index < 2 ? index : null)
    const msg: Control = { type: 'lineup', cars: empty, identities: ids, positions: places }
    expect(decodeControl(encodeControl(msg))).toEqual(msg)
    expect(decodeControl(packet({ ...msg, positions: [0, 1, 2, null, null, null, null, null] }))).toBeNull()
  })

  it('exchanges control variants, validates slot bounds and keeps old versions explicitly decodable', () => {
    const msgs: Control[] = [
      { type: 'prepare', slot: 7, laps: 2, lighting: 'night', protocolVersion: 3 },
      { type: 'ready', car: 'green', identity, protocolVersion: 3, name: 'Racer 8' },
      { type: 'armed', round: 9 },
      { type: 'start', cars: [...cars], delay: 1000, readyAge: 20, round: 9 },
      { type: 'finish', slot: 7, time: 43.2, round: 9 },
      { type: 'left', slot: 7, round: 9 },
      { type: 'share-offer' }, { type: 'share-ready' }, { type: 'share-result', status: 'saved' },
    ]
    for (const msg of msgs) expect(decodeControl(encodeControl(msg))).toEqual(msg)
    expect(decodeControl(packet({ type: 'prepare', slot: 1, laps: 2, lighting: 'day' }))).toMatchObject({ type: 'prepare', slot: 1 })
    expect(decodeControl(packet({ type: 'ready', car: 'blue', identity }))).toMatchObject({ type: 'ready' })
    for (const slot of [-1, 0, 8]) expect(decodeControl(packet({ type: 'prepare', slot, laps: 2, lighting: 'day' }))).toBeNull()
    expect(decodeControl(packet({ type: 'finish', slot: 8, time: 30 }))).toBeNull()
    expect(decodeControl(packet({ type: 'left', slot: 8 }))).toBeNull()
    expect(decodeControl(packet({ type: 'start', cars: [...cars], delay: 6000, readyAge: 0 }))).toBeNull()
    for (const bad of [0, 256, '3', 1.5, null]) {
      expect(decodeControl(packet({ type: 'prepare', slot: 1, laps: 2, lighting: 'day', protocolVersion: bad }))).toBeNull()
    }
  })

  it('rejects malformed and oversize control messages before parsing or staging', () => {
    expect(decodeControl(new Uint8Array())).toBeNull()
    expect(decodeControl(new Uint8Array([Packet.Control]))).toBeNull()
    expect(decodeControl(new Uint8Array([Packet.Pose, 123]))).toBeNull()
    expect(decodeControl(packet({ type: 'unknown' }))).toBeNull()
    expect(decodeControl(packet(null))).toBeNull()
    expect(decodeControl(new Uint8Array(2049))).toBeNull()
  })
})
