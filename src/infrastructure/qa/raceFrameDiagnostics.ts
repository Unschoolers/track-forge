/** Bounded frame timing samples for the most recent race. Durations are CPU
 * timings; render submission does not measure GPU completion. */
export class RaceFrameDiagnostics {
  private runId: number | undefined
  private previous = 0
  private updateStart = 0
  private simulationStart = 0
  private simulationMs = 0
  private updateMs = 0
  private renderStart = 0
  private ready = false
  private count = 0
  private dropped = 0
  private readonly frames: number[][] = []

  constructor(private readonly now: () => number = () => performance.now()) {}

  beginUpdate(runId: number): void {
    if (this.runId !== runId) {
      this.runId = runId
      this.previous = 0
      this.count = 0
      this.dropped = 0
      this.frames.length = 0
    }
    this.updateStart = this.now()
  }

  beginSimulation(): void { this.simulationStart = this.now() }
  endSimulation(): void { this.simulationMs = this.now() - this.simulationStart }
  endUpdate(): void { this.updateMs = this.now() - this.updateStart; this.ready = true }
  beginRender(): void { if (this.ready) this.renderStart = this.now() }

  afterRender(time: number, tick: number, running: boolean): void {
    if (!this.ready) return
    this.ready = false
    if (!running) { this.previous = 0; return }
    if (this.previous > 0 && time > this.previous) {
      this.count++
      if (this.frames.length < 36000) {
        this.frames.push([tick, time - this.previous, this.updateMs, this.simulationMs, this.now() - this.renderStart])
      } else this.dropped++
    }
    this.previous = time
  }

  report(runId: number | undefined) {
    if (this.runId === undefined || this.runId !== runId) return null
    return {
      version: 1,
      units: 'milliseconds',
      columns: ['simulationTick', 'frameInterval', 'raceUpdate', 'simulation', 'renderSubmission'],
      frameCount: this.count,
      droppedFrames: this.dropped,
      frames: this.frames,
    }
  }
}
