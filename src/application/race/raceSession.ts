import { EventBus, type Unsubscribe } from '@/application/eventBus'
import type { RandomSource } from '@/application/ports/random'
import type {
  ScoreEntry,
  ScoreStore,
} from '@/application/ports/storage'
import type {
  CarId,
  DifficultyId,
  Track,
  TrackId,
} from '@/domain/model'
import {
  stepRace,
  type RaceStep,
} from '@/domain/race/raceEngine'
import { createRace } from '@/domain/race/raceFactory'
import { rankVehicles } from '@/domain/race/ranking'
import type {
  DriverInput,
  RaceOutcome,
  RacePhase,
  RaceState,
  RaceVehicle,
} from '@/domain/race/raceState'
import { resetVehicleToTrack } from '@/domain/race/trackContext'
import type { FeedbackPort } from '@/application/ports/feedback'
import { CAR_SPECS } from '@/domain/config'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'

export interface RaceSetup {
  readonly car: CarId
  readonly difficulty: DifficultyId
  readonly laps: number
}

export interface RaceTelemetry {
  readonly phase: RacePhase
  readonly countdown: number
  readonly elapsed: number
  readonly position: number
  readonly vehicleCount: number
  readonly lap: number
  readonly totalLaps: number
  readonly damage: number
  readonly damageLimit: number
}

export interface RaceStanding {
  readonly id: string
  readonly car: CarId
  readonly player: boolean
  readonly place: number
  readonly finishTime: number | null
  readonly wrecked: boolean
  readonly lap: number
}

export interface RaceResult {
  readonly outcome: RaceOutcome
  readonly trackId: TrackId
  readonly trackName: string
  readonly playerPlace: number
  readonly playerTime: number | null
  readonly playerWrecked: boolean
  readonly newRecord: boolean
  readonly standings: readonly RaceStanding[]
  readonly highScores: readonly ScoreEntry[]
}

export interface RaceSessionSnapshot {
  readonly track: Track | null
  readonly setup: RaceSetup | null
  readonly state: RaceState | null
  readonly telemetry: RaceTelemetry
  readonly standings: readonly RaceStanding[]
  readonly result: RaceResult | null
}

export interface RaceSessionPort {
  start(track: Track, setup: RaceSetup): void
  restart(): void
  resetPlayer(): void
  setPaused(paused: boolean): void
  advance(deltaSeconds: number, input: DriverInput): void
  snapshot(): RaceSessionSnapshot
  subscribe(listener: (snapshot: RaceSessionSnapshot) => void): Unsubscribe
  destroy(): void
}

export interface RaceSessionDependencies {
  readonly scoreStore: ScoreStore
  readonly random: RandomSource
  readonly feedback: FeedbackPort
  readonly now?: () => number
  readonly step?: RaceStep
  readonly geometry?: TrackGeometryService
}

const EMPTY_TELEMETRY: RaceTelemetry = {
  phase: 'countdown',
  countdown: 3.7,
  elapsed: 0,
  position: 1,
  vehicleCount: 0,
  lap: 0,
  totalLaps: 0,
  damage: 0,
  damageLimit: 0,
}

// Limit running catch-up to 250 ms per frame after background stalls.
const FIXED_STEP = 1 / 60
const MAX_CATCH_UP = 0.25

export class RaceSession implements RaceSessionPort {
  private readonly events = new EventBus<RaceSessionSnapshot>()
  private readonly now: () => number
  private readonly step: RaceStep
  private current: RaceSessionSnapshot = {
    track: null,
    setup: null,
    state: null,
    telemetry: EMPTY_TELEMETRY,
    standings: [],
    result: null,
  }
  private remainder = 0
  private destroyed = false
  private readonly geometry: TrackGeometryService

  constructor(private readonly dependencies: RaceSessionDependencies) {
    this.now = dependencies.now ?? (() => Date.now())
    this.step = dependencies.step ?? stepRace
    this.geometry = dependencies.geometry ?? new TrackGeometryService()
  }

  start(track: Track, setup: RaceSetup): void {
    if (this.destroyed) return
    this.dependencies.feedback.silenceContinuous()
    this.remainder = 0
    const state = createRace({
      path: this.geometry.get(track).path,
      playerCar: setup.car,
      difficulty: setup.difficulty,
      laps: setup.laps,
      startRatio: track.start?.ratio,
      reversed: track.start?.reversed,
    })
    this.publish(this.buildSnapshot(track, setup, state, null))
  }

  restart(): void {
    const { track, setup } = this.current
    if (!track || !setup || this.destroyed) return
    this.start(track, setup)
  }

  resetPlayer(): void {
    const state = this.current.state
    if (state?.phase !== 'running' || this.destroyed) return
    this.publish(
      this.buildSnapshot(
        this.current.track,
        this.current.setup,
        {
          ...state,
          vehicles: state.vehicles.map((vehicle) =>
            vehicle.player
              ? resetVehicleToTrack(vehicle, state.path, { reversed: state.reversed })
              : vehicle,
          ),
        },
        this.current.result,
      ),
    )
  }

  setPaused(paused: boolean): void {
    if (this.destroyed) return
    if (paused) this.dependencies.feedback.silenceContinuous()
    const state = this.current.state
    if (!state || state.paused === paused) return
    this.remainder = 0
    this.publish(
      this.buildSnapshot(
        this.current.track,
        this.current.setup,
        { ...state, paused },
        this.current.result,
      ),
    )
  }

  advance(deltaSeconds: number, input: DriverInput): void {
    let state = this.current.state
    if (!state || state.paused || state.phase === 'finished' || this.destroyed ||
        !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return

    let runningTime = deltaSeconds
    let countdownChanged = false
    if (state.phase === 'countdown') {
      const countdown = Math.max(0, state.countdown - deltaSeconds)
      runningTime = Math.max(0, deltaSeconds - state.countdown)
      state = { ...state, countdown, phase: countdown <= Number.EPSILON ? 'running' : 'countdown' }
      countdownChanged = true
    }

    this.remainder += Math.min(runningTime, MAX_CATCH_UP)
    const events: ReturnType<RaceStep>['events'][number][] = []
    let stepped = false
    let peakShake = 0
    while (state.phase === 'running' && this.remainder + 1e-10 >= FIXED_STEP) {
      const next = this.step(state, input, FIXED_STEP, this.dependencies.random)
      state = next.state
      peakShake = Math.max(peakShake, state.cameraHints.shake)
      events.push(...next.events)
      this.remainder = Math.max(0, this.remainder - FIXED_STEP)
      stepped = true
    }
    if (!stepped && !countdownChanged) return
    if (stepped) state = { ...state, cameraHints: { ...state.cameraHints, shake: peakShake } }
    if (state.phase === 'finished') this.remainder = 0
    const terminalEvent = events.find((event) => event.type === 'race-finished')
    const resultState = terminalEvent?.reason === 'water' ? this.withoutPlayerFinish(state) : state
    const result = resultState.phase === 'finished'
      ? (this.current.result ?? this.createResult(resultState, terminalEvent?.reason))
      : null
    if (stepped) this.routeFeedback(resultState, events, input)
    if (result && !this.current.result) {
      this.dependencies.feedback.silenceContinuous()
      this.dependencies.feedback.handle({
        type: 'finish',
        place: result.playerPlace,
        newRecord: result.newRecord,
      })
    }
    this.publish(this.buildSnapshot(this.current.track, this.current.setup, resultState, result))
  }

  snapshot(): RaceSessionSnapshot {
    return this.current
  }

  subscribe(listener: (snapshot: RaceSessionSnapshot) => void): Unsubscribe {
    if (this.destroyed) return () => undefined
    return this.events.subscribe(listener)
  }

  destroy(): void {
    if (this.destroyed) return
    this.dependencies.feedback.silenceContinuous()
    this.destroyed = true
    this.events.clear()
  }

  private buildSnapshot(
    track: Track | null,
    setup: RaceSetup | null,
    state: RaceState,
    result: RaceResult | null,
  ): RaceSessionSnapshot {
    const ranked = rankVehicles(state.vehicles, state.path.points.length, state.startPathIndex, state.reversed)
    const standings = ranked.map((vehicle, index) =>
      this.toStanding(vehicle, index),
    )
    const player = ranked.find((vehicle) => vehicle.player)
    return {
      track,
      setup,
      state,
      standings,
      result,
      telemetry: {
        phase: state.phase,
        countdown: state.countdown,
        elapsed: state.elapsed,
        position: player ? ranked.indexOf(player) + 1 : 1,
        vehicleCount: state.vehicles.length,
        lap: player?.lap ?? 0,
        totalLaps: state.totalLaps,
        damage: player?.damage ?? 0,
        damageLimit: player?.damageLimit ?? 0,
      },
    }
  }

  private createResult(
    state: RaceState,
    terminalReason?: RaceOutcome,
  ): RaceResult | null {
    const track = this.current.track
    const setup = this.current.setup
    if (!track || !setup) return null
    const ranked = rankVehicles(state.vehicles, state.path.points.length, state.startPathIndex, state.reversed)
    const player = ranked.find((vehicle) => vehicle.player)
    if (!player) return null
    const outcome =
      terminalReason ??
      (player.wrecked
        ? 'wrecked'
        : player.finishedAt !== null
          ? 'finished'
          : null)
    if (!outcome) return null
    const oldScores = this.dependencies.scoreStore.forTrack(track.id)
    const playerTime =
      outcome === 'finished' ? player.finishedAt : null
    const newRecord =
      playerTime !== null &&
      (oldScores[0] === undefined || playerTime < oldScores[0].time)
    if (playerTime !== null) {
      this.dependencies.scoreStore.record(track.id, {
        time: playerTime,
        car: setup.car,
        difficulty: setup.difficulty,
        recordedAt: this.now(),
      })
    }
    return {
      outcome,
      trackId: track.id,
      trackName: track.name,
      playerPlace: ranked.indexOf(player) + 1,
      playerTime,
      playerWrecked: player.wrecked,
      newRecord,
      standings: ranked.map((vehicle, index) =>
        this.toStanding(vehicle, index),
      ),
      highScores: this.dependencies.scoreStore.forTrack(track.id),
    }
  }

  private withoutPlayerFinish(state: RaceState): RaceState {
    const player = state.vehicles.find((vehicle) => vehicle.player)
    if (player?.finishedAt === null || !player) return state
    return {
      ...state,
      vehicles: state.vehicles.map((vehicle) =>
        vehicle.player ? { ...vehicle, finishedAt: null } : vehicle,
      ),
    }
  }

  private routeFeedback(
    state: RaceState,
    events: ReturnType<RaceStep>['events'],
    input: DriverInput,
  ): void {
    const player = state.vehicles.find((vehicle) => vehicle.player)
    if (player) {
      const speedRatio = Math.min(
        1,
        player.speed / CAR_SPECS[player.car].max,
      )
      this.dependencies.feedback.handle({
        type: 'engine',
        car: player.car,
        speedRatio,
        throttle: player.braking ? 0 : 1,
        cornering: Math.min(1, Math.abs(input.steering)),
      })
      this.dependencies.feedback.handle({
        type: 'surface',
        surface: player.currentSurface,
        speedRatio,
      })
      if (player.slip > 8) {
        this.dependencies.feedback.handle({
          type: 'tire-slip',
          strength: Math.min(1, player.slip / 80),
        })
      }
    }
    for (const event of events) {
      if (event.type === 'curb-hit' && event.vehicleId === 'player') {
        this.dependencies.feedback.handle({
          type: 'curb',
          speed: event.speed,
        })
      } else if (
        (event.type === 'collision' &&
          (event.leftId === 'player' || event.rightId === 'player')) ||
        (event.type === 'barrier-collision' &&
          event.vehicleId === 'player')
      ) {
        this.dependencies.feedback.handle({
          type: 'collision',
          strength: event.strength,
        })
      }
    }
  }

  private toStanding(
    vehicle: RaceVehicle,
    index: number,
  ): RaceStanding {
    return {
      id: vehicle.id,
      car: vehicle.car,
      player: vehicle.player,
      place: index + 1,
      finishTime: vehicle.finishedAt,
      wrecked: vehicle.wrecked,
      lap: vehicle.lap,
    }
  }

  private publish(snapshot: RaceSessionSnapshot): void {
    this.current = snapshot
    this.events.publish(snapshot)
  }
}
