import type { RaceSetup } from '@/application/race/raceSession'
import type { RacePhase } from '@/domain/race/raceState'

const SAMPLE_DURATION_MS = 5_000
const MAX_SAMPLES = 2_048

type Status = 'idle' | 'waiting-for-countdown' | 'waiting-for-go' | 'sampling' | 'complete' | 'interrupted'

interface RenderedRace {
  readonly track: { readonly name: string } | null
  readonly setup: RaceSetup | null
  readonly state: {
    readonly phase: RacePhase
    readonly paused: boolean
    readonly vehicles: { readonly length: number }
  } | null
}

interface RaceDetails {
  readonly name: string
  readonly setup: RaceSetup
  readonly vehicleCount: number
}

function percentiles(samples: Float64Array, count: number): { p50: number; p95: number; p99: number } | null {
  if (!count) return null
  const sorted = samples.slice(0, count).sort()
  const rank = (fraction: number) => sorted[Math.ceil(count * fraction) - 1] ?? 0
  return { p50: rank(0.50), p95: rank(0.95), p99: rank(0.99) }
}

export class RacePerformance {
  private readonly frameIntervals = new Float64Array(MAX_SAMPLES)
  private readonly raceUpdates = new Float64Array(MAX_SAMPLES)
  private readonly simulations = new Float64Array(MAX_SAMPLES)
  private readonly renderSubmissions = new Float64Array(MAX_SAMPLES)
  private status: Status = 'idle'
  private race: RaceDetails | null = null
  private clickedAt = 0
  private startToCountdownMs: number | null = null
  private sampleCount = 0
  private sampleDurationMs = 0
  private firstFrameTime = 0
  private previousFrameTime = 0
  private updateReady = false
  private updateStartedAt = 0
  private simulationStartedAt = 0
  private renderStartedAt = 0
  private raceUpdateMs = 0
  private simulationMs = 0

  constructor(
    private readonly countdownVisible: () => boolean,
    private readonly now: () => number = () => performance.now(),
  ) {}

  private get active(): boolean {
    return this.status === 'waiting-for-countdown' || this.status === 'waiting-for-go' || this.status === 'sampling'
  }

  markStart(): void {
    this.clickedAt = this.now()
    this.race = null
    this.startToCountdownMs = null
    this.sampleCount = 0
    this.sampleDurationMs = 0
    this.updateReady = false
    this.status = 'waiting-for-countdown'
  }

  interrupt(): void {
    if (!this.active) return
    this.status = 'interrupted'
    this.updateReady = false
  }

  beginUpdate(): this | undefined {
    if (!this.active) return undefined
    this.updateStartedAt = this.now()
    return this
  }

  beginSimulation(): void {
    this.simulationStartedAt = this.now()
  }

  endSimulation(): void {
    this.simulationMs = this.now() - this.simulationStartedAt
  }

  endUpdate(): void {
    this.raceUpdateMs = this.now() - this.updateStartedAt
    this.updateReady = true
  }

  beginRender(): void {
    if (this.updateReady) this.renderStartedAt = this.now()
  }

  afterRender(frameTime: number, race: RenderedRace): void {
    if (!this.active) return
    if (!this.updateReady) {
      if (this.status !== 'waiting-for-countdown') this.interrupt()
      return
    }
    this.updateReady = false
    const renderedAt = this.now()
    const { track, setup, state } = race
    if (!track || !setup || !state || state.paused || state.phase === 'finished') {
      this.interrupt()
      return
    }

    if (this.status === 'waiting-for-countdown') {
      if (!this.countdownVisible()) {
        if (state.phase === 'running') this.interrupt()
        return
      }
      this.startToCountdownMs = renderedAt - this.clickedAt
      this.race = { name: track.name, setup, vehicleCount: state.vehicles.length }
      this.status = 'waiting-for-go'
    }
    if (state.phase !== 'running') {
      if (this.status === 'sampling') this.interrupt()
      return
    }

    // The first running frame can include work from the countdown.
    if (this.status === 'waiting-for-go') {
      this.firstFrameTime = frameTime
      this.previousFrameTime = frameTime
      this.status = 'sampling'
      return
    }
    const intervalMs = frameTime - this.previousFrameTime
    if (intervalMs <= 0) return
    this.previousFrameTime = frameTime
    this.sampleDurationMs = frameTime - this.firstFrameTime
    this.frameIntervals[this.sampleCount] = intervalMs
    this.raceUpdates[this.sampleCount] = this.raceUpdateMs
    this.simulations[this.sampleCount] = this.simulationMs
    this.renderSubmissions[this.sampleCount] = renderedAt - this.renderStartedAt
    this.sampleCount += 1
    if (this.sampleDurationMs >= SAMPLE_DURATION_MS || this.sampleCount >= MAX_SAMPLES) {
      this.status = 'complete'
    }
  }

  report() {
    const count = this.active ? 0 : this.sampleCount
    return {
      status: this.status,
      race: this.race && { ...this.race, setup: { ...this.race.setup } },
      startToCountdownMs: this.startToCountdownMs,
      sampleCount: this.sampleCount,
      sampleDurationMs: this.sampleDurationMs,
      frameIntervalMs: percentiles(this.frameIntervals, count),
      raceUpdateMs: percentiles(this.raceUpdates, count),
      simulationMs: percentiles(this.simulations, count),
      renderSubmissionMs: percentiles(this.renderSubmissions, count),
    }
  }
}

/** The benchmark starts from the real setup button and measures the rendered race. */
export function installRacePerformance(): RacePerformance {
  const recorder = new RacePerformance(() =>
    Boolean(document.querySelector('[data-screen="race"] .race-countdown.visible [data-race-countdown]')?.textContent),
  )
  const benchmarkWindow = window as Window & {
    __trackForgeRacePerformance?: { report: () => ReturnType<RacePerformance['report']> }
  }
  benchmarkWindow.__trackForgeRacePerformance = { report: () => recorder.report() }

  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button[data-action="setup-start"]')) {
      recorder.markStart()
    }
  }, { capture: true })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) recorder.interrupt()
  })
  window.addEventListener('pagehide', () => recorder.interrupt())
  window.addEventListener('trackforge:pause', () => recorder.interrupt())
  return recorder
}
