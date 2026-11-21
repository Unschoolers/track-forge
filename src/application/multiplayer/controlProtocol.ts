import { CAR_IDS, type CarId, type LightingMode } from '@/domain/model'
import { START_GRID_SIZE } from '@/domain/race/startGrid'
import { isPlayerIdentity, type PlayerIdentity } from '@/application/multiplayer/playerIdentity'
import { Packet } from '@/application/multiplayer/raceWire'
import { normalizeDisplayName } from '@/domain/track/trackCreator'

export const MAX_PLAYERS = START_GRID_SIZE
const MAX_CONTROL_BYTES = 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type Control =
  | { type: 'prepare'; slot: number; laps: number; lighting: LightingMode; round?: number }
  | { type: 'ready'; car: CarId; identity: PlayerIdentity; round?: number; name?: string }
  | { type: 'lineup'; cars: (CarId | null)[]; identities: (PlayerIdentity | null)[]; positions: (number | null)[]; round?: number; names?: (string | null)[] }
  | { type: 'armed'; round?: number }
  | { type: 'start'; cars: (CarId | null)[]; delay: number; readyAge: number; round?: number }
  | { type: 'finish'; slot: number; time: number | null; round?: number }
  | { type: 'left'; slot: number; round?: number }
  | { type: 'share-offer' }
  | { type: 'share-ready' }
  | { type: 'share-result'; status: 'saved' | 'declined' }

export function encodeControl(message: Control): Uint8Array {
  const payload = encoder.encode(JSON.stringify(message))
  const packet = new Uint8Array(payload.length + 1)
  packet[0] = Packet.Control
  packet.set(payload, 1)
  return packet
}

function isCar(value: unknown): value is CarId {
  return CAR_IDS.some(car => car === value)
}

function validCars(value: unknown): value is (CarId | null)[] {
  return Array.isArray(value) && value.length === MAX_PLAYERS &&
    value.every(car => car === null || isCar(car))
}

export function validLineupPositions(
  cars: readonly (CarId | null)[],
  positions: readonly (number | null)[],
): boolean {
  if (!Array.isArray(positions) || positions.length !== MAX_PLAYERS) return false
  const active = cars.filter(car => car !== null).length
  const occupied = positions.filter(slot => slot !== null)
  return occupied.length === active && new Set(occupied).size === active &&
    positions.every((position, playerSlot) => cars[playerSlot] === null
      ? position === null : position !== null && Number.isInteger(position) && position >= 0 && position < active)
}

function validLineupNames(names: unknown, cars: readonly (CarId | null)[]): boolean {
  return names === undefined || Array.isArray(names) && names.length === MAX_PLAYERS &&
    names.every((name, index) => cars[index] === null
      ? name === null : name === null || normalizeDisplayName(name) === name)
}

function validRound(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) &&
    value >= 0 && value <= 65_535)
}

function isControl(value: unknown): value is Control {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as Record<string, unknown>
  if (!validRound(message.round)) return false
  switch (message.type) {
    case 'share-offer':
    case 'share-ready': return true
    case 'share-result': return message.status === 'saved' || message.status === 'declined'
    case 'prepare':
      return typeof message.slot === 'number' && Number.isInteger(message.slot) &&
        message.slot > 0 && message.slot < MAX_PLAYERS &&
        typeof message.laps === 'number' && Number.isInteger(message.laps) &&
        message.laps >= 1 && message.laps <= 5 &&
        (message.lighting === 'day' || message.lighting === 'night')
    case 'ready':
      return isCar(message.car) && isPlayerIdentity(message.identity) &&
        (message.name === undefined || normalizeDisplayName(message.name) === message.name)
    case 'lineup': {
      const cars = message.cars
      const identities = message.identities
      const positions = message.positions
      if (!validCars(cars) || !Array.isArray(identities) ||
        identities.length !== MAX_PLAYERS || !Array.isArray(positions)) return false
      return identities.every((identity, index) => cars[index] === null
        ? identity === null : isPlayerIdentity(identity)) &&
        validLineupPositions(cars, positions) && validLineupNames(message.names, cars)
    }
    case 'armed': return true
    case 'start':
      return validCars(message.cars) &&
        typeof message.delay === 'number' && Number.isFinite(message.delay) &&
        message.delay >= 0 && message.delay <= 5000 &&
        typeof message.readyAge === 'number' && Number.isFinite(message.readyAge) &&
        message.readyAge >= 0 && message.readyAge <= 30_000
    case 'finish':
      return typeof message.slot === 'number' && Number.isInteger(message.slot) &&
        message.slot >= 0 && message.slot < MAX_PLAYERS &&
        (message.time === null || (typeof message.time === 'number' &&
          Number.isFinite(message.time) && message.time > 0 && message.time < 86_400))
    case 'left':
      return typeof message.slot === 'number' && Number.isInteger(message.slot) &&
        message.slot > 0 && message.slot < MAX_PLAYERS
    default: return false
  }
}

/** One bounded, validated control envelope. Unknown or malformed messages are rejected. */
export function decodeControl(bytes: Uint8Array): Control | null {
  if (bytes.length < 2 || bytes.length > MAX_CONTROL_BYTES || bytes[0] !== Packet.Control) return null
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes.subarray(1)))
    return isControl(value) ? value : null
  } catch {
    // Invalid network JSON is a rejected input, not an application exception.
    return null
  }
}
