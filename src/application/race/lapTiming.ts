/** Gate times use the same cumulative fixed-step clock as replay frames. */
export class LapTiming {
  readonly splits: number[] = []
  bestLap: number | null = null
  gap: number | null = null
  private lapStart = 0
  private valid = true
  private lapValid = true

  constructor(private readonly target?: readonly number[]) {}

  recover(): void {
    this.valid = false
    this.lapValid = false
    this.gap = null
  }

  readonly accepted: { lap: number; gate: 1 | 2 | 3 | 4; time: number }[] = []

  accept(lap: number, gate: 1 | 2 | 3 | 4, elapsed: number): void {
    this.accepted.push({ lap, gate, time: elapsed })
    const index = lap * 4 + gate - 1
    if (this.valid) this.splits.push(elapsed)
    const reference = this.target?.[index]
    this.gap = this.valid && reference !== undefined ? elapsed - reference : null
    if (gate === 4) {
      if (this.lapValid) {
        const duration = elapsed - this.lapStart
        this.bestLap = this.bestLap === null ? duration : Math.min(this.bestLap, duration)
      }
      this.lapStart = elapsed
      this.lapValid = true
    }
  }

  abandonLap(lap: number): void {
    this.recover()
    while (this.accepted.at(-1)?.lap === lap) this.accepted.pop()
  }

  currentLap(elapsed: number): number | null {
    return this.lapValid ? Math.max(0, elapsed - this.lapStart) : null
  }

  complete(laps: number): readonly number[] | undefined {
    return this.valid && this.splits.length === laps * 4 ? this.splits : undefined
  }
}
