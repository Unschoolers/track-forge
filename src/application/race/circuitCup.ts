import type { CarId, DifficultyId } from '@/domain/model'
import type { RaceStanding } from '@/application/race/raceSession'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { randomGridPositions } from '@/domain/race/startGrid'

export const CUP_CIRCUITS = [...OFFICIAL_CIRCUITS]

export interface CupDriver { readonly id: string; readonly label: string; readonly points: number }
export interface CircuitCup {
  readonly car: CarId
  readonly difficulty: DifficultyId
  readonly index: number
  readonly rounds: readonly (readonly CupDriver[])[]
  /** Frozen on starting a cup; legacy four-round cups omit this field. */
  readonly trackIds?: readonly string[]
}
export const MAX_CUP_ROUNDS = 12
export const DEFAULT_CUP_TRACK_IDS = CUP_CIRCUITS.map(({ track }) => track.id)
export function validCupLineup(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_CUP_ROUNDS &&
    value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 120)
}
/** Immutable cup-lineup edit rules; invalid requests never alter the current lineup. */
export function removeCupTrack(lineup: readonly string[], index: number): string[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= lineup.length) return null
  return lineup.filter((_, current) => current !== index)
}

export function moveCupTrack(lineup: readonly string[], index: number, direction: -1 | 1): string[] | null {
  const target = index + direction
  if ((direction !== -1 && direction !== 1) || !Number.isInteger(index) ||
      index < 0 || target < 0 || index >= lineup.length || target >= lineup.length) return null
  const updated = [...lineup]
  const selected = updated[index]
  const displaced = updated[target]
  if (selected === undefined || displaced === undefined) return null
  updated[index] = displaced
  updated[target] = selected
  return updated
}

export function cupTrackIds(cup: CircuitCup): readonly string[] {
  return cup.trackIds ?? DEFAULT_CUP_TRACK_IDS
}
export function cupRoundCount(cup: CircuitCup): number { return cupTrackIds(cup).length }
export interface CupProgress {
  readonly checkpoint: CircuitCup | null
  readonly bestPlacement: number | null
  /** The single most recently built lineup, not a library of saved cups. */
  readonly lineup?: readonly string[]
}
export function createCup(car: CarId = 'blue', difficulty: DifficultyId = 'normal', trackIds: readonly string[] = DEFAULT_CUP_TRACK_IDS): CircuitCup {
  if (!validCupLineup(trackIds) || !trackIds.length) throw new Error('A cup needs 1–12 tracks.')
  return { car, difficulty, index: 0, rounds: [], trackIds: [...trackIds] }
}
export function recordCupResult(cup: CircuitCup, standings: readonly RaceStanding[]): CircuitCup {
  if (cup.rounds.length > cup.index) return cup
  const points = [10, 6, 4, 2]
  return { ...cup, rounds: [...cup.rounds, standings.map((driver) => ({ id: driver.id, label: driver.player ? 'You' : driver.car.toUpperCase(), points: points[driver.place - 1] ?? 0 }))] }
}
export function retryCupRace(cup: CircuitCup): CircuitCup {
  return { ...cup, rounds: cup.rounds.slice(0, cup.index) }
}
export function cupStandings(cup: CircuitCup): CupDriver[] {
  const totals = new Map<string, CupDriver>()
  for (const round of cup.rounds) for (const driver of round) {
    const previous = totals.get(driver.id)
    totals.set(driver.id, { ...driver, points: (previous?.points ?? 0) + driver.points })
  }
  return [...totals.values()].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id))
}
/** A series rewards trailing drivers with front slots; its first grid is random. */
export function cupGridPositions(cup: CircuitCup, random: () => number = Math.random): number[] {
  if (!cup.rounds.length) return randomGridPositions(4, random)
  // Vehicle array order and cup IDs remain stable even as their start pads move.
  const ids = ['player', 'ai-1', 'ai-2', 'ai-3']
  const ranked = cupStandings(cup).map((driver) => driver.id)
  const slowestFirst = [...ranked].reverse()
  const ordered = [...slowestFirst, ...ids.filter((id) => !ranked.includes(id))]
  return ids.map((id) => ordered.indexOf(id))
}

export function advanceCup(cup: CircuitCup): CircuitCup {
  return cup.rounds.length > cup.index && cup.index < cupRoundCount(cup) - 1
    ? { ...cup, index: cup.index + 1 } : cup
}
