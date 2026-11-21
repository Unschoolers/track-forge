import type { RandomSource } from '@/domain/race/randomSource'

// Preserve the application port's public type import for existing consumers.
export type { RandomSource } from '@/domain/race/randomSource'

export const mathRandom: RandomSource = {
  next: () => Math.random(),
}
