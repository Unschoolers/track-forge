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

  cross(beforeLap: number, beforeSector: number, lap: number, sector: number, elapsed: number): void {
    const before = beforeLap * 4 + beforeSector - 1
    const after = lap * 4 + sector - 1
    if (after <= before) {
      if (sector < beforeSector || lap < beforeLap) this.recover()
      return
    }
    for (let gate = before; gate < after; gate++) {
      if (this.valid) this.splits.push(elapsed)
      const reference = this.target?.[gate]
      this.gap = this.valid && reference !== undefined ? elapsed - reference : null
      if ((gate + 1) % 4 === 0) {
        if (this.lapValid) {
          const duration = elapsed - this.lapStart
          this.bestLap = this.bestLap === null ? duration : Math.min(this.bestLap, duration)
        }
        this.lapStart = elapsed
        this.lapValid = true
      }
    }
  }

  currentLap(elapsed: number): number | null {
    return this.lapValid ? Math.max(0, elapsed - this.lapStart) : null
  }

  complete(laps: number): readonly number[] | undefined {
    return this.valid && this.splits.length === laps * 4 ? this.splits : undefined
  }
}
