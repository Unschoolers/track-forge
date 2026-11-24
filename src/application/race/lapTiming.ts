/** Gate times use the same cumulative fixed-step clock as replay frames. */
export class LapTiming {
  readonly splits: number[] = []
  bestLap: number | null = null
  gap: number | null = null
  private lapStart = 0
  private valid = true
  private lapValid = true

  constructor(private readonly target?: readonly number[], private readonly gatesPerLap = target?.length ?? 1) {}

  recover(): void {
    this.valid = false
    this.lapValid = false
    this.gap = null
  }

  readonly accepted: { lap: number; gate: number; time: number }[] = []

  accept(lap: number, gate: number, elapsed: number): void {
    this.accepted.push({ lap, gate, time: elapsed })
    const index = lap * this.gatesPerLap + gate - 1
    if (this.valid) this.splits.push(elapsed)
    const reference = this.target?.[index]
    this.gap = this.valid && reference !== undefined ? elapsed - reference : null
    if (gate === this.gatesPerLap) {
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
    return this.valid && this.splits.length === laps * this.gatesPerLap ? this.splits : undefined
  }
}
