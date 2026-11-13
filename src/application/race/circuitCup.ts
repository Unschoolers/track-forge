import type { RaceStanding } from '@/application/race/raceSession'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'

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
export interface CircuitCup { readonly index: number; readonly rounds: readonly (readonly CupDriver[])[] }
export function createCup(): CircuitCup { return { index: 0, rounds: [] } }
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
export function advanceCup(cup: CircuitCup): CircuitCup {
  return cup.rounds.length > cup.index && cup.index < CUP_CIRCUITS.length - 1
    ? { ...cup, index: cup.index + 1 } : cup
}
