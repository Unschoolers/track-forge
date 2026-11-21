/**
 * Source of pseudo-random values supplied by the race host.
 *
 * Deterministic simulations inject a seeded source; production adapters may
 * use Math.random. Domain code must never draw global randomness itself.
 */
export interface RandomSource {
  next(): number
}
