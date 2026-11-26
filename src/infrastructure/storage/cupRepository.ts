import type { CupStore, KeyValueStore } from '@/application/ports/storage'
import { cupRoundCount, cupTrackIds, DEFAULT_CUP_TRACK_IDS, validCupLineup, type CircuitCup, type CupProgress } from '@/application/race/circuitCup'
import { isCarId, isDifficultyId } from '@/domain/model'

const KEY = 'trackforge-cup-v1'
const RETIRED_OFFICIAL_TRACKS = new Set([
  'official-meadow', 'official-hairpin', 'official-frost',
  'official-bridge', 'official-quarry', 'official-switchback',
  'official-city-sprint', 'official-desert-sweep', 'official-toy-box',
])
function includesRetired(ids: readonly string[]): boolean {
  return ids.some(id => RETIRED_OFFICIAL_TRACKS.has(id))
}
function migratedLineup(value: unknown): readonly string[] {
  if (!validCupLineup(value)) return [...DEFAULT_CUP_TRACK_IDS]
  const retained = value.filter(id => !RETIRED_OFFICIAL_TRACKS.has(id))
  return value.length > 0 && retained.length === 0
    ? [...DEFAULT_CUP_TRACK_IDS]
    : retained
}
function validCup(value: unknown): value is CircuitCup {
  if (!value || typeof value !== 'object') return false
  const cup = value as CircuitCup
  return isCarId(cup.car) && isDifficultyId(cup.difficulty) &&
    (cup.trackIds === undefined || (validCupLineup(cup.trackIds) && cup.trackIds.length > 0)) &&
    Number.isInteger(cup.index) && cup.index >= 0 && cup.index < cupRoundCount(cup) &&
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
      if (data?.version !== 1 && data?.version !== 2) {
        return { checkpoint: null, bestPlacement: null, lineup: [...DEFAULT_CUP_TRACK_IDS] }
      }
      const bestPlacement = Number.isInteger(data.bestPlacement) &&
        data.bestPlacement >= 1 && data.bestPlacement <= 4 ? data.bestPlacement : null
      const checkpoint = validCup(data.checkpoint) ? data.checkpoint : null
      // Version 1 implicitly referred to the retired four-track Cup.
      // Explicitly authored, non-retired user lineups are still resumable.
      const safeCheckpoint = checkpoint &&
        (data.version === 2 || checkpoint.trackIds !== undefined) &&
        !includesRetired(cupTrackIds(checkpoint)) ? checkpoint : null
      return { checkpoint: safeCheckpoint, bestPlacement, lineup: migratedLineup(data.lineup) }
    } catch { return { checkpoint: null, bestPlacement: null, lineup: [...DEFAULT_CUP_TRACK_IDS] } }
  }
  save(progress: CupProgress): boolean { return this.storage.set(KEY, JSON.stringify({ version: 2, ...progress })) }
}
