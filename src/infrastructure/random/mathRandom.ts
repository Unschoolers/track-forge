import type { RandomSource } from '@/domain/race/randomSource'

/** Non-seeded production randomness; deterministic race tests inject their own source. */
export const mathRandom: RandomSource = { next: () => Math.random() }
