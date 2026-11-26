import type { BitmapWorkSample } from '@/phaser/rendering/meadowBitmapRenderer'

const PRESENTATION_COLUMNS = [
  'frameTime', 'updateStart', 'groundAndCullingMs', 'vehiclesAndEffectsMs', 'lightingMs',
  'cameraX', 'cameraY', 'cameraZoom', 'cameraRotation',
  'hillBatches', 'hillPrimitives', 'waterBatches', 'waterPrimitives',
  'bridgeBatches', 'bridgePrimitives', 'lampBatches',
  'roadTilesNeeded', 'roadTilesVisible', 'roadTilesResident',
  'terrainTilesNeeded', 'terrainTilesVisible', 'terrainTilesResident',
  'bridgeApproachTilesNeeded', 'bridgeApproachTilesVisible', 'bridgeApproachTilesResident',
  'bridgeDeckTilesNeeded', 'bridgeDeckTilesVisible', 'bridgeDeckTilesResident',
] as const

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
  private readonly bitmapWork: (BitmapWorkSample & { readonly afterFrame: number })[] = []
  private droppedBitmapWork = 0
  private readonly presentationFrames: (number[] | null)[] = []
  private presentation: readonly number[] | undefined
  private groundStart = 0
  private groundEnd = 0
  private vehicleEnd = 0
  private runStart = 0
  private running = false
  private readonly longTasks: number[][] = []
  private droppedLongTasks = 0
  private renderer: { type: string; width: number; height: number } | null = null

  setRenderer(type: string, width: number, height: number): void {
    this.renderer = { type, width, height }
  }

  beginGround(): void { this.groundStart = this.now() }
  endGround(): void { this.groundEnd = this.now() }
  endVehicles(): void { this.vehicleEnd = this.now() }

  recordPresentation(values: readonly number[]): void {
    this.presentation = values
  }

  recordLongTask(startTime: number, duration: number): void {
    if (!this.running || startTime < this.runStart) return
    if (this.longTasks.length >= 2048) { this.droppedLongTasks++; return }
    this.longTasks.push([startTime, duration])
  }

  constructor(private readonly now: () => number = () => performance.now()) {}

  beginUpdate(runId: number): void {
    if (this.runId !== runId) {
      this.runId = runId
      this.previous = 0
      this.count = 0
      this.dropped = 0
      this.frames.length = 0
      this.bitmapWork.length = 0
      this.droppedBitmapWork = 0
      this.presentationFrames.length = 0
      this.longTasks.length = 0
      this.droppedLongTasks = 0
      this.running = false
      this.runStart = this.now()
    }
    this.presentation = undefined
    this.updateStart = this.now()
  }

  beginSimulation(): void { this.simulationStart = this.now() }
  endSimulation(): void { this.simulationMs = this.now() - this.simulationStart }
  endUpdate(): void { this.updateMs = this.now() - this.updateStart; this.ready = true }
  beginRender(): void { if (this.ready) this.renderStart = this.now() }

  afterRender(time: number, tick: number, running: boolean): void {
    if (!this.ready) return
    this.ready = false
    this.running = running
    if (!running) { this.previous = 0; return }
    if (this.previous > 0 && time > this.previous) {
      this.count++
      if (this.frames.length < 36000) {
        this.frames.push([tick, time - this.previous, this.updateMs, this.simulationMs, this.now() - this.renderStart])
        this.presentationFrames.push(this.presentation ? [
          time, this.updateStart, this.groundEnd - this.groundStart,
          this.vehicleEnd - this.groundEnd, this.updateStart + this.updateMs - this.vehicleEnd,
          ...this.presentation,
        ] : null)
      } else this.dropped++
    }
    this.previous = time
  }

  /** POST_RENDER texture work runs after the frame sample; its cost belongs
   * to the interval leading into the next sample, not the current one. */
  recordBitmapWork(sample: BitmapWorkSample): void {
    if (this.runId === undefined || this.previous <= 0) return
    if (this.bitmapWork.length >= 36000) { this.droppedBitmapWork++; return }
    this.bitmapWork.push({ ...sample, afterFrame: this.count })
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
      bitmapWork: this.bitmapWork,
      droppedBitmapWork: this.droppedBitmapWork,
      presentationColumns: PRESENTATION_COLUMNS,
      presentationFrames: this.presentationFrames,
      renderer: this.renderer,
      longTaskColumns: ['startTime', 'duration'],
      longTasks: this.longTasks,
      droppedLongTasks: this.droppedLongTasks,
    }
  }
}
