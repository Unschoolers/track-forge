/** Physical grid slots are independent from racer identities or vehicle array order. */
export const START_GRID_SIZE = 4

export function randomGridPositions(count: number, random: () => number = Math.random): number[] {
  if (!Number.isInteger(count) || count < 1 || count > START_GRID_SIZE) {
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

/** A nearby phone only simulates its own player, which may occupy any start slot. */
export function gridPositionsForPlayer(slot: number): number[] {
  if (!Number.isInteger(slot) || slot < 0 || slot >= START_GRID_SIZE) {
    throw new RangeError('Invalid player grid slot.')
  }
  return [slot, ...Array.from({ length: START_GRID_SIZE }, (_, index) => index).filter((index) => index !== slot)]
}
