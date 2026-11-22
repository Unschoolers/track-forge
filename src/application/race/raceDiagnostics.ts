import type { RaceEvent } from '@/domain/race/raceEngine'
import { RACE_TICK_SECONDS } from '@/domain/race/raceEngine'
import type { DriverInput, RaceState, RaceVehicle } from '@/domain/race/raceState'
import type { Track } from '@/domain/model'
import type { RaceResult, RaceSetup } from './raceSession'

/** Diagnostic replay: independent of the best-ghost record and never written to localStorage. */
const BASE_SAMPLE_TICKS = 3 // 20 Hz positions, on the fixed 60 Hz simulation clock
const MAX_FRAMES = 6000
const MAX_EVENTS = 10000

const round = (value: number): number => Math.round(value * 1000) / 1000

export interface DiagnosticVehicle {
  readonly id: string
  readonly car: RaceVehicle['car']
  readonly player: boolean
  readonly x: number
  readonly y: number
  readonly z: number
  readonly angle: number
  readonly vx: number
  readonly vy: number
  readonly speed: number
  readonly yawRate: number
  readonly slip: number
  readonly verticalVelocity: number
  readonly grounded: boolean
  readonly braking: boolean
  readonly pathIndex: number
  readonly pathDistance: number
  readonly lap: number
  readonly nextSector: number
  readonly finishedAt: number | null
  readonly wrecked: boolean
  readonly currentSurface: RaceVehicle['currentSurface']
  readonly structureRunId: string | null
  readonly aiPace: number
  readonly ai: {
    readonly phase: string
    readonly targetLane: number
    readonly steer: number
    readonly passTargetId: string | null
  } | null
  /** Position discontinuity caused by a recovery; do not interpolate across it. */
  readonly cut?: boolean
}

export interface DiagnosticFrame {
  readonly tick: number
  readonly t: number
  readonly vehicles: readonly DiagnosticVehicle[]
  readonly input?: DriverInput
}

export interface DiagnosticEvent {
  readonly tick: number
  readonly t: number
  readonly event: RaceEvent | { readonly type: 'manual-reset'; readonly vehicleId: string }
}

export interface RaceDiagnosticsReport {
  readonly format: 'trackforge-race-replay'
  readonly formatVersion: 1
  readonly tickSeconds: number
  readonly sampleTicks: number
  readonly track: Track
  readonly setup: RaceSetup
  readonly result: RaceResult
  readonly frames: readonly DiagnosticFrame[]
  readonly events: readonly DiagnosticEvent[]
  readonly droppedEvents: number
}

/**
 * Captures every car without affecting physics. If a race runs unusually long,
 * halve historical samples and increase the sample interval instead of growing forever.
 */
export class RaceDiagnosticsRecording {
  private frames: DiagnosticFrame[] = []
  private events: DiagnosticEvent[] = []
  private pendingCuts = new Set<string>()
  private sampleTicks = BASE_SAMPLE_TICKS
  private droppedEvents = 0

  constructor(state: RaceState) {
    this.capture(state)
  }

  record(state: RaceState, events: readonly RaceEvent[], input?: DriverInput): void {
    let forceCapture = false
    for (const event of events) {
      if (event.type === 'vehicle-recovered') {
        this.pendingCuts.add(event.vehicleId)
        forceCapture = true
      } else if (event.type === 'race-finished') {
        forceCapture = true
      }
      this.recordEvent(state, event)
    }
    this.capture(state, input, forceCapture)
  }

  manualReset(state: RaceState, vehicleId: string): void {
    this.pendingCuts.add(vehicleId)
    this.recordEvent(state, { type: 'manual-reset', vehicleId })
    this.capture(state, undefined, true)
  }

  /** The report stays available through the results modal, including rivals' final five seconds. */
  report(track: Track, setup: RaceSetup, result: RaceResult): RaceDiagnosticsReport {
    return {
      format: 'trackforge-race-replay',
      formatVersion: 1,
      tickSeconds: RACE_TICK_SECONDS,
      sampleTicks: this.sampleTicks,
      track,
      setup,
      result,
      frames: [...this.frames],
      events: [...this.events],
      droppedEvents: this.droppedEvents,
    }
  }

  private recordEvent(state: RaceState, event: DiagnosticEvent['event']): void {
    if (this.events.length === MAX_EVENTS) {
      this.droppedEvents++
      return
    }
    this.events.push({ tick: state.tick, t: round(state.elapsed), event })
  }

  private capture(state: RaceState, input?: DriverInput, force = false): void {
    const last = this.frames.at(-1)
    if (!force && last && state.tick - last.tick < this.sampleTicks) return
    const frame: DiagnosticFrame = {
      tick: state.tick,
      t: round(state.elapsed),
      vehicles: state.vehicles.map(vehicle => ({
        id: vehicle.id, car: vehicle.car, player: vehicle.player,
        x: round(vehicle.x), y: round(vehicle.y), z: round(vehicle.z),
        angle: round(vehicle.angle), vx: round(vehicle.vx), vy: round(vehicle.vy),
        speed: round(vehicle.speed), yawRate: round(vehicle.yawRate),
        slip: round(vehicle.slip), verticalVelocity: round(vehicle.verticalVelocity),
        grounded: vehicle.grounded, braking: vehicle.braking,
        pathIndex: vehicle.pathIndex, pathDistance: round(vehicle.pathDistance),
        lap: vehicle.lap, nextSector: vehicle.nextSector,
        finishedAt: vehicle.finishedAt, wrecked: vehicle.wrecked,
        currentSurface: vehicle.currentSurface, structureRunId: vehicle.structureRunId,
        aiPace: round(vehicle.aiPace),
        ai: vehicle.ai ? {
          phase: vehicle.ai.phase,
          targetLane: round(vehicle.ai.targetLane),
          steer: round(vehicle.ai.steer),
          passTargetId: vehicle.ai.passTargetId ?? null,
        } : null,
        ...(this.pendingCuts.has(vehicle.id) ? { cut: true } : {}),
      })),
      ...(input ? { input: { steering: round(input.steering), throttle: round(input.throttle), braking: input.braking } } : {}),
    }
    if (last?.tick === frame.tick) this.frames[this.frames.length - 1] = frame
    else this.frames.push(frame)
    this.pendingCuts.clear()
    if (this.frames.length > MAX_FRAMES) {
      const start = this.frames[0]
      const compact = this.frames.filter((_, index) => index % 2 === 0 || index === this.frames.length - 1 ||
        this.frames[index]?.vehicles.some(vehicle => vehicle.cut))
      this.frames = start && compact[0] !== start ? [start, ...compact] : compact
      this.sampleTicks *= 2
      // Cuts are sparse; pathological repeated recoveries remain bounded by the hard cap.
      if (this.frames.length > MAX_FRAMES) this.frames = [this.frames[0], ...this.frames.slice(-(MAX_FRAMES - 1))].filter(
        (value): value is DiagnosticFrame => value !== undefined,
      )
    }
  }
}
