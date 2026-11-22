/** Physical grid slots are independent from racer identities or vehicle array order. */
export const START_GRID_SIZE = 4
/** Multiplayer can choose eight physical starting pads without spawning eight solo AI cars. */
export const NEARBY_START_GRID_SIZE = 8
export const EXTRA_NEARBY_GRID = [
  { lane: -20, back: 78 }, { lane: 20, back: 88 },
  { lane: -8, back: 116 }, { lane: 8, back: 126 },
] as const

export function randomGridPositions(count: number, random: () => number = Math.random): number[] {
  if (!Number.isInteger(count) || count < 1 || count > NEARBY_START_GRID_SIZE) {
    throw new RangeError('Invalid grid player count.')
  }
  const positions = Array.from({ length: count }, (_, index) => index)
  for (let index = count - 1; index > 0; index--) {
    const roll = random()
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
      throw new RangeError('Grid random source must return a value between 0 and 1.')
    }
    const swapIndex = Math.floor(roll * (index + 1))
    const original = positions[index]!
    positions[index] = positions[swapIndex]!
    positions[swapIndex] = original
  }
  return positions
}

export function validGridPositions(value: unknown, count = START_GRID_SIZE): value is readonly number[] {
  return Array.isArray(value) && value.length === count &&
    value.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < count) &&
    new Set(value).size === count
}

/** A nearby phone only simulates its own player, which may occupy any of eight pads. */
export function gridPositionsForPlayer(slot: number): number[] {
  if (!Number.isInteger(slot) || slot < 0 || slot >= NEARBY_START_GRID_SIZE) {
    throw new RangeError('Invalid player grid slot.')
  }
  return [slot, ...Array.from({ length: START_GRID_SIZE }, (_, index) => index).filter((index) => index !== slot)].slice(0, START_GRID_SIZE)
}

/** Validate four simulated vehicles referencing any of the eight Nearby starting pads. */
export function validNearbyGridPositions(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length === START_GRID_SIZE &&
    value.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < NEARBY_START_GRID_SIZE) &&
    new Set(value).size === START_GRID_SIZE
}
