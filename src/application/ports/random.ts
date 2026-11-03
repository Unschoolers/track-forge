export interface RandomSource {
  next(): number
}

export const mathRandom: RandomSource = {
  next: () => Math.random(),
}
