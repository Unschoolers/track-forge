import type { LightingMode } from '@/domain/model'
import { raceCategory, sameCategory } from '@/application/race/raceRecords'
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
import {
  ghostPoseAt,
  type GhostPose,
  type GhostRun,
  type GhostStore,
} from '@/application/race/ghostReplay'
import { LapTiming } from '@/application/race/lapTiming'
import { GhostRecording } from '@/application/race/ghostRecording'

export interface RaceSetup {
  readonly lighting?: LightingMode
  readonly car: CarId
  readonly difficulty: DifficultyId
  readonly laps: number
  readonly handling?: 'arcade' | 'simulation'
  readonly mode?: 'normal' | 'ghost'
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
  readonly currentLapTime?: number | null
  readonly bestLapTime?: number | null
  readonly ghostGap?: number | null
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
  readonly previousBestTime?: number
  readonly scoreSaveFailed?: boolean
  readonly standings: readonly RaceStanding[]
  readonly highScores: readonly ScoreEntry[]
  readonly ghostTime?: number
  readonly ghostSaved?: boolean
  readonly ghostSaveFailed?: boolean
  readonly savedGhostTime?: number
}

export interface RaceSessionSnapshot {
  readonly track: Track | null
  readonly setup: RaceSetup | null
  readonly state: RaceState | null
  readonly telemetry: RaceTelemetry
  readonly standings: readonly RaceStanding[]
  readonly result: RaceResult | null
  readonly ghost?: GhostPose | null
  readonly ghostTime?: number
}

export interface RaceSessionPort {
  ghostTime?(track: Track, setup: RaceSetup): number | null
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
  readonly ghostStore?: GhostStore
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
  private bestGhost: GhostRun | null = null
  private recording: GhostRecording | null = null
  private timing = new LapTiming()

  constructor(private readonly dependencies: RaceSessionDependencies) {
    this.now = dependencies.now ?? (() => Date.now())
    this.step = dependencies.step ?? stepRace
    this.geometry = dependencies.geometry ?? new TrackGeometryService()
  }

  start(track: Track, setup: RaceSetup): void {
    if (this.destroyed) return
    this.dependencies.feedback.silenceContinuous()
    this.remainder = 0
    this.bestGhost = this.dependencies.ghostStore?.load(track, setup) ?? null
    this.timing = new LapTiming(setup.mode === 'ghost' && this.bestGhost?.splits?.length === setup.laps * 4
      ? this.bestGhost.splits : undefined)
    const resolved = { ...setup, lighting: setup.lighting ?? track.lighting, mode: setup.mode === 'ghost' && this.bestGhost ? 'ghost' as const : 'normal' as const }
    const created = createRace({
      path: this.geometry.get(track).path,
      playerCar: setup.car,
      difficulty: setup.difficulty,
      laps: setup.laps,
      handling: setup.handling,
      startRatio: track.start?.ratio,
      reversed: track.start?.reversed,
    })
    const state = resolved.mode === 'ghost'
      ? { ...created, vehicles: created.vehicles.filter((vehicle) => vehicle.player) }
      : created
    const player = state.vehicles.find((vehicle) => vehicle.player)
    this.recording = player && this.dependencies.ghostStore
      ? new GhostRecording(player, (setup.handling ?? 'arcade') === 'arcade') : null
    this.publish(this.buildSnapshot(track, resolved, state, null))
  }

  ghostTime(track: Track, setup: RaceSetup): number | null {
    return this.dependencies.ghostStore?.load(track, setup)?.time ?? null
  }

  restart(): void {
    const { track, setup } = this.current
    if (!track || !setup || this.destroyed) return
    this.start(track, setup)
  }

  resetPlayer(): void {
    const state = this.current.state
    if (state?.phase !== 'running' || state.paused || this.destroyed) return
    const reset = state.vehicles.map((vehicle) => vehicle.player
      ? resetVehicleToTrack(vehicle, state.path, { reversed: state.reversed }) : vehicle)
    const before = state.vehicles.find((vehicle) => vehicle.player)
    const after = reset.find((vehicle) => vehicle.player)
    if (before && after) this.recording?.recover(before, after, state.elapsed)
    this.timing.recover()
    this.publish(
      this.buildSnapshot(
        this.current.track,
        this.current.setup,
        {
          ...state,
          vehicles: reset,
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
    let peakLanding = 0
    while (state.phase === 'running' && this.remainder + 1e-10 >= FIXED_STEP) {
      const before = state.vehicles.find((vehicle) => vehicle.player)
      const next = this.step(state, input, FIXED_STEP, this.dependencies.random)
      state = next.state
      peakShake = Math.max(peakShake, state.cameraHints.shake)
      events.push(...next.events)
      const recovered = next.events.some((event) => event.type === 'vehicle-recovered' &&
          next.state.vehicles.some((vehicle) => vehicle.player && vehicle.id === event.vehicleId))
      if (recovered) {
        this.timing.recover()
        const after = next.state.vehicles.find((vehicle) => vehicle.player)
        if (before && after) this.recording?.recover(before, after, state.elapsed)
      }
      const player = state.vehicles.find((vehicle) => vehicle.player)
      if (before && player && !recovered) this.timing.cross(before.lap, before.nextSector, player.lap, player.nextSector, state.elapsed)
      if (player && state.phase !== 'finished') this.recording?.sample(player, state.elapsed)
      if (before && player && !before.grounded && player.grounded) {
        peakLanding = Math.max(peakLanding, player.landingIntensity)
      }
      this.remainder = Math.max(0, this.remainder - FIXED_STEP)
      stepped = true
    }
    if (!stepped && !countdownChanged) return
    if (stepped) state = { ...state, cameraHints: { ...state.cameraHints, shake: peakShake } }
    if (state.phase === 'finished') this.remainder = 0
    const terminalEvent = events.find((event) => event.type === 'race-finished')
    const resultState = terminalEvent?.reason === 'water' ? this.withoutPlayerFinish(state) : state
    let result = resultState.phase === 'finished'
      ? (this.current.result ?? this.createResult(resultState, terminalEvent?.reason))
      : null
    if (stepped) this.routeFeedback(resultState, events, input, peakLanding)
    if (result && !this.current.result) {
      const track = this.current.track
      const setup = this.current.setup
      const player = resultState.vehicles.find((vehicle) => vehicle.player)
      if (track && setup && player && this.dependencies.ghostStore &&
          result.outcome === 'finished' && result.playerTime !== null) {
        const frames = this.recording?.finish(player, result.playerTime)
        if (frames) {
          const previous = this.dependencies.ghostStore.load(track, setup)
          const saved = this.dependencies.ghostStore.record(track, setup, result.playerTime, frames, this.timing.complete(setup.laps))
          const best = this.dependencies.ghostStore.load(track, setup)
          const failed = !saved && (!previous || result.playerTime < previous.time)
          result = { ...result, ghostSaved: saved, ghostSaveFailed: failed,
            ...(best ? { savedGhostTime: best.time } : {}) }
        }
      }
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
      ghost: setup?.mode === 'ghost' && this.bestGhost ? ghostPoseAt(this.bestGhost, state.elapsed) : null,
      ...(setup?.mode === 'ghost' && this.bestGhost ? { ghostTime: this.bestGhost.time } : {}),
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
        currentLapTime: this.timing.currentLap(state.elapsed),
        bestLapTime: this.timing.bestLap,
        ghostGap: this.timing.gap,
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
    const category = raceCategory(track, setup)
    const comparable = (score: ScoreEntry) => sameCategory(score, category, setup)
    const oldScores = this.dependencies.scoreStore.forTrack(track.id).filter(comparable)
    const previousBestTime = oldScores.length ? Math.min(...oldScores.map((score) => score.time)) : undefined
    const playerTime =
      outcome === 'finished' ? player.finishedAt : null
    const recordCandidate =
      playerTime !== null &&
      (previousBestTime === undefined || playerTime < previousBestTime)
    let scoreSaved = true
    if (playerTime !== null) {
      scoreSaved = this.dependencies.scoreStore.record(track.id, {
        time: playerTime,
        category,
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
      newRecord: recordCandidate && scoreSaved,
      ...(previousBestTime !== undefined ? { previousBestTime } : {}),
      ...(playerTime !== null && !scoreSaved ? { scoreSaveFailed: true } : {}),
      standings: ranked.map((vehicle, index) =>
        this.toStanding(vehicle, index),
      ),
      highScores: this.dependencies.scoreStore.forTrack(track.id).filter(comparable),
      ...(setup.mode === 'ghost' && this.bestGhost ? { ghostTime: this.bestGhost.time } : {}),
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
    peakLanding: number,
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
        throttle: player.braking ? 0 : input.throttle,
        cornering: Math.min(1, Math.abs(input.steering)),
      })
      this.dependencies.feedback.handle({
        type: 'surface',
        surface: player.currentSurface,
        speedRatio,
      })
      this.dependencies.feedback.handle({
        type: 'tire-slip',
        strength: player.slip > 8 ? Math.min(1, player.slip / 80) : 0,
        speedRatio,
        surface: player.currentSurface,
      })
      if (peakLanding > 0.1) {
        this.dependencies.feedback.handle({ type: 'landing', strength: peakLanding })
      }
      const rival = state.vehicles
        .filter((vehicle) => !vehicle.player && !vehicle.wrecked && vehicle.finishedAt === null)
        .map((vehicle) => ({ vehicle, distance: Math.hypot(vehicle.x - player.x, vehicle.y - player.y) }))
        .sort((a, b) => a.distance - b.distance)[0]
      const dx = (rival?.vehicle.x ?? player.x) - player.x
      const dy = (rival?.vehicle.y ?? player.y) - player.y
      this.dependencies.feedback.handle({
        type: 'rival',
        proximity: rival ? Math.max(0, 1 - rival.distance / 250) : 0,
        pan: rival && rival.distance > 0 ? Math.max(-1, Math.min(1, (-Math.sin(player.angle) * dx + Math.cos(player.angle) * dy) / rival.distance)) : 0,
        speedRatio: rival ? Math.min(1, rival.vehicle.speed / CAR_SPECS[rival.vehicle.car].max) : 0,
      })
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
