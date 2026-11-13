import type { CupStore, KeyValueStore } from '@/application/ports/storage'
import { CUP_CIRCUITS, type CircuitCup, type CupProgress } from '@/application/race/circuitCup'
import { isCarId, isDifficultyId } from '@/domain/model'

const KEY = 'trackforge-cup-v1'
function validCup(value: unknown): value is CircuitCup {
  if (!value || typeof value !== 'object') return false
  const cup = value as CircuitCup
  return isCarId(cup.car) && isDifficultyId(cup.difficulty) &&
    Number.isInteger(cup.index) && cup.index >= 0 && cup.index < CUP_CIRCUITS.length &&
    Array.isArray(cup.rounds) &&
    (cup.rounds.length === cup.index || cup.rounds.length === cup.index + 1) &&
    cup.rounds.every((round) =>
      Array.isArray(round) && round.length > 0 && round.length <= 4 &&
      round.every((driver) => driver && typeof driver.id === 'string' &&
        typeof driver.label === 'string' && [0, 2, 4, 6, 10].includes(driver.points)) &&
      new Set(round.map((driver) => driver.id)).size === round.length &&
      round.some((driver) => driver.id === 'player'))
}
export class BrowserCupRepository implements CupStore {
  constructor(private readonly storage: KeyValueStore) {}
  load(): CupProgress {
    try {
      const data = JSON.parse(this.storage.get(KEY) ?? 'null')
      if (data?.version !== 1) return { checkpoint: null, bestPlacement: null }
      const bestPlacement = Number.isInteger(data.bestPlacement) &&
        data.bestPlacement >= 1 && data.bestPlacement <= 4 ? data.bestPlacement : null
      return { checkpoint: validCup(data.checkpoint) ? data.checkpoint : null, bestPlacement }
    } catch { return { checkpoint: null, bestPlacement: null } }
  }
  save(progress: CupProgress): boolean { return this.storage.set(KEY, JSON.stringify({ version: 1, ...progress })) }
}
