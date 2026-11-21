import type { CarId, DifficultyId } from '@/domain/model'
import type { RaceStanding } from '@/application/race/raceSession'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { randomGridPositions } from '@/domain/race/startGrid'

export const CUP_CIRCUITS = [
  'official-meadow',
  'official-hairpin',
  'official-frost',
  'official-bridge',
].map((id) => {
  const circuit = OFFICIAL_CIRCUITS.find(({ track }) => track.id === id)
  if (!circuit) throw new Error(`Missing Arcade Cup circuit: ${id}`)
  return circuit
})

export interface CupDriver { readonly id: string; readonly label: string; readonly points: number }
export interface CircuitCup { readonly car: CarId; readonly difficulty: DifficultyId; readonly index: number; readonly rounds: readonly (readonly CupDriver[])[] }
export interface CupProgress {
  readonly checkpoint: CircuitCup | null
  readonly bestPlacement: number | null
}
export function createCup(car: CarId = 'blue', difficulty: DifficultyId = 'normal'): CircuitCup { return { car, difficulty, index: 0, rounds: [] } }
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
  return cup.rounds.length > cup.index && cup.index < CUP_CIRCUITS.length - 1
    ? { ...cup, index: cup.index + 1 } : cup
}
