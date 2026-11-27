import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import { CAR_IDS, normalizeRouteKind, type LightingMode, type RouteKind } from '@/domain/model'
import { EventBus, type Unsubscribe } from '@/application/eventBus'
import type { RandomSource } from '@/application/ports/random'
import type {
  ScoreEntry,
  ScoreStore,
} from '@/application/ports/storage'
import type {
  CarId,
  CreatorGhostChallenge,
  DifficultyId,
  Track,
  TrackId,
} from '@/domain/model'
import {
  RACE_TICK_SECONDS,
  isRivalRacing,
  recoverRacePlayer,
  stepFinishingRivals,
  stepRace,
  type RaceStep,
} from '@/domain/race/raceEngine'
import { createRace } from '@/domain/race/raceFactory'
import { rankVehicles, raceProgress } from '@/domain/race/ranking'
import { countdownCue } from '@/domain/race/raceState'
import type {
  DriverInput,
  RaceOutcome,
  RacePhase,
  RaceState,
} from '@/domain/race/raceState'
import type { FeedbackPort } from '@/application/ports/feedback'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import {
  ghostPoseAt,
  type GhostAvailability,
  type GhostPose,
  type GhostRun,
  type GhostSetup,
  type GhostStore,
} from '@/application/race/ghostReplay'
import { LapTiming } from '@/application/race/lapTiming'
import { GhostRecording } from '@/application/race/ghostRecording'
import { decodeCreatorGhostChallenge } from '@/domain/track/creatorGhostChallenge'
import { interpolateRaceState } from '@/application/race/racePresentation'
import { RaceDiagnosticsRecording, type RaceDiagnosticsReport } from '@/application/race/raceDiagnostics'
import { createRaceResult, toRaceStanding } from '@/application/race/raceResultRecorder'
import { routeRaceFeedback } from '@/application/race/raceFeedback'
import { DRIFT_BOOST_V1_RULES } from '@/domain/race/driftBoost'
import type { DriftBoostRules } from '@/domain/race/driftBoost'
import { BOOST_PRACTICE_AVAILABLE } from '@/application/race/boostPracticeConfig'

export type RaceMode = 'normal' | 'ghost' | 'time-trial' | 'nearby' | 'boost-practice'

export interface RaceSetup {
  readonly lighting?: LightingMode
  readonly car: CarId
  readonly difficulty: DifficultyId
  readonly laps: number
  readonly mode?: RaceMode
  /** Fixed for retry. New quick races get a fresh order from the controller. */
  readonly gridPositions?: readonly number[]
  /** Frozen for this run; omitted for ordinary races. */
  readonly driftBoostRules?: DriftBoostRules
}

export interface RaceSplit { readonly lap: number; readonly gate: number; readonly time: number }

export interface RaceTelemetry {
  readonly routeKind?: RouteKind
  readonly routeProgress?: number
  readonly latestSplit?: RaceSplit
  readonly finishGate?: number
  readonly phase: RacePhase
  readonly waitingForStart?: boolean
  readonly countdown: number
  readonly elapsed: number
  readonly position: number
  readonly positionKnown?: boolean
  readonly vehicleCount: number
  readonly lap: number
  readonly totalLaps: number
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
  readonly lap: number
}

export interface RaceResult {
  readonly mode?: RaceMode
  readonly routeKind?: RouteKind
  readonly splits?: readonly RaceSplit[]
  readonly finishGate?: number
  readonly outcome: RaceOutcome
  readonly trackId: TrackId
  readonly trackName: string
  readonly playerPlace: number
  readonly playerTime: number | null
  readonly newRecord: boolean
  readonly previousBestTime?: number
  readonly scoreSaveFailed?: boolean
  readonly standings: readonly RaceStanding[]
  readonly rivalsFinishing?: boolean
  readonly highScores: readonly ScoreEntry[]
  readonly ghostTime?: number
  readonly ghostSaved?: boolean
  readonly ghostSaveFailed?: boolean
  readonly savedGhostTime?: number
}

export interface RaceSessionSnapshot {
  /** Changes for every new race, including a rematch on the same circuit. */
  readonly runId?: number
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
  ghostSetups?(track: Track): readonly GhostSetup[]
  ghostAvailability?(track: Track, setup: RaceSetup): GhostAvailability
  ghostTime?(track: Track, setup: RaceSetup): number | null
  creatorGhostChallenge?(track: Track, setup: RaceSetup, completedRun?: boolean): CreatorGhostChallenge | null
  diagnosticsReport?(): RaceDiagnosticsReport | null
  start(track: Track, setup: RaceSetup, startsAt?: number): void
  scheduleNearbyStart?(startsAt: number): void
  restart(): void
  stop(): void
  resetPlayer(): void
  setPaused(paused: boolean): void
  advance(deltaSeconds: number, input: DriverInput): void
  snapshot(): RaceSessionSnapshot
  /** Optional render-only interpolation for display refresh rates above or below 60 Hz. */
  presentationState?(): RaceState | null
  nearbyGhosts?(): readonly GhostPose[]
  subscribe(listener: (snapshot: RaceSessionSnapshot) => void): Unsubscribe
  destroy(): void
}

export interface RaceSessionDependencies {
  readonly nearby?: (Pick<NearbyRace, 'update' | 'remotePoses' | 'recovered' | 'finish' | 'captureFinalFrame'> & Partial<Pick<NearbyRace, 'livePosition' | 'synchronizedElapsed'>>) | undefined
  readonly scoreStore: ScoreStore
  readonly random: RandomSource
  readonly feedback: FeedbackPort
  readonly now?: () => number
  /** Shared monotonic clock for Nearby countdown times (independent of wall clock). */
  readonly monotonicNow?: () => number
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
}

// Limit running catch-up to 250 ms per frame after background stalls.
const MAX_CATCH_UP = 0.25
// After the player finishes, continue real rival physics long enough for a
// competitive field to finish; otherwise even valid times 10-35 seconds back
// become misleading UNFINISHED rows. Stops early once all rivals finish.
const RIVAL_FINISH_SECONDS = 40
const EMPTY_RACE: RaceSessionSnapshot = {
  track: null, setup: null, state: null, telemetry: EMPTY_TELEMETRY, standings: [], result: null,
}

function oneRunForOpenRoute(track: Track, setup: RaceSetup): RaceSetup {
  return track.routeKind === 'point-to-point' && setup.laps !== 1 ? { ...setup, laps: 1 } : setup
}

export class RaceSession implements RaceSessionPort {
  private readonly events = new EventBus<RaceSessionSnapshot>()
  private readonly now: () => number
  private readonly monotonicNow: () => number
  private readonly step: RaceStep
  private current = EMPTY_RACE
  private runId = 0
  private lastPositionCueAt = Number.NEGATIVE_INFINITY
  private remainder = 0
  private previousPresentationTick: RaceState | null = null
  private presentationDiscontinuities = new Set<string>()
  private startsAt: number | undefined
  private localCountdownCuePending = false
  private nearbyTimingOffset = 0
  private rivalFinishRemaining = 0
  private destroyed = false
  private readonly geometry: TrackGeometryService
  private bestGhost: GhostRun | null = null
  private completedGhost: { readonly trackId: Track['id']; readonly car: CarId; readonly laps: number; readonly run: GhostRun } | null = null
  private recording: GhostRecording | null = null
  private diagnostics: RaceDiagnosticsRecording | null = null
  private timing = new LapTiming()

  constructor(private readonly dependencies: RaceSessionDependencies) {
    this.now = dependencies.now ?? (() => Date.now())
    this.monotonicNow = dependencies.monotonicNow ?? (() => performance.now())
    this.step = dependencies.step ?? stepRace
    this.geometry = dependencies.geometry ?? new TrackGeometryService()
  }

  start(track: Track, setup: RaceSetup, startsAt?: number): void {
    if (this.destroyed) return
    if (setup.mode === 'boost-practice' && !BOOST_PRACTICE_AVAILABLE) return
    if (setup.mode === 'boost-practice' && setup.driftBoostRules && !setup.driftBoostRules.enabled) return
    if (setup.mode === 'boost-practice' && !setup.driftBoostRules) {
      setup = { ...setup, driftBoostRules: DRIFT_BOOST_V1_RULES }
    } else if (setup.mode !== 'boost-practice' && setup.driftBoostRules) {
      const withoutBoostRules = { ...setup }
      delete withoutBoostRules.driftBoostRules
      setup = withoutBoostRules
    }
    this.previousPresentationTick = null
    this.completedGhost = null
    this.presentationDiscontinuities.clear()
    this.dependencies.feedback.silenceContinuous()
    this.remainder = 0
    this.rivalFinishRemaining = 0
    this.lastPositionCueAt = Number.NEGATIVE_INFINITY
    const routeKind = normalizeRouteKind(track.routeKind)
    setup = oneRunForOpenRoute(track, setup)
    this.startsAt = setup.mode === 'nearby' ? startsAt : undefined
    this.nearbyTimingOffset = 0
    const nearby = setup.mode === 'nearby'
    this.localCountdownCuePending = !nearby
    const boostPractice = setup.mode === 'boost-practice'
    const challenge = setup.mode === 'ghost' ? track.creatorChallenge : undefined
    this.bestGhost = nearby || boostPractice ? null
      : challenge ? (challenge.laps === setup.laps ? challenge : null)
        : this.dependencies.ghostStore?.load(track, setup) ?? null
    const resolved = { ...setup, lighting: setup.lighting ?? track.lighting, mode: setup.mode === 'ghost' && !this.bestGhost ? (routeKind === 'point-to-point' ? 'time-trial' as const : 'normal' as const) : setup.mode ?? 'normal' }
    const created = createRace({
      path: this.geometry.get(track).path,
      playerCar: setup.car,
      difficulty: setup.difficulty,
      laps: setup.laps,
      startRatio: track.start?.ratio,
      reversed: routeKind === 'point-to-point' ? false : track.start?.reversed,
      routeKind,
      gridPositions: setup.gridPositions,
      recoveryCheckpoints: track.recoveryCheckpoints,
      ...(setup.driftBoostRules ? { driftBoostRules: setup.driftBoostRules } : {}),
    })
    const gatesPerLap = (created.timingGates?.length ?? 0) + 1
    this.timing = new LapTiming(
      setup.mode === 'ghost' && this.bestGhost?.splits?.length === setup.laps * gatesPerLap
        ? this.bestGhost.splits : undefined,
      gatesPerLap,
    )
    const state = nearby || resolved.mode === 'ghost' || resolved.mode === 'time-trial' || boostPractice
      ? { ...created, countdown: this.startsAt === undefined ? created.countdown : Math.max(0, (this.startsAt - this.monotonicNow()) / 1000),
          vehicles: created.vehicles.filter((vehicle) => vehicle.player) }
      : created
    const player = state.vehicles.find((vehicle) => vehicle.player)
    this.recording = !nearby && !boostPractice && player && this.dependencies.ghostStore
      ? new GhostRecording(player) : null
    this.diagnostics = nearby ? null : new RaceDiagnosticsRecording(state)
    this.runId += 1
    this.publish(this.buildSnapshot(track, resolved, state, null))
    if (nearby && this.startsAt !== undefined) {
      this.dependencies.feedback.handle({ type: 'countdown', cue: countdownCue(state.countdown) })
    }
  }

  /** Armed by the host only after all peers report their race scenes ready. */
  scheduleNearbyStart(startsAt: number): void {
    if (!Number.isFinite(startsAt) || this.current.setup?.mode !== 'nearby' ||
        this.current.state?.phase !== 'countdown' || this.startsAt !== undefined) return
    this.startsAt = startsAt
    const { track, setup, state } = this.current
    const countdown = Math.max(0, (startsAt - this.monotonicNow()) / 1000)
    this.publish(this.buildSnapshot(track, setup, { ...state, countdown }, null))
    this.dependencies.feedback.handle({ type: 'countdown', cue: countdownCue(countdown) })
  }

  /** Available replay combinations for the race preparation selectors. */
  ghostSetups(track: Track): readonly GhostSetup[] {
    if (track.creatorChallenge) {
      const { car, laps } = track.creatorChallenge
      return [{ car, laps }]
    }
    const store = this.dependencies.ghostStore
    if (!store) return []
    if (store.availableSetups) return store.availableSetups(track)
    const laps = track.routeKind === 'point-to-point' ? [1] : [1, 2, 3]
    return CAR_IDS.flatMap(car => laps.flatMap(laps =>
      store.load(track, { car, laps }) ? [{ car, laps }] : []))
  }

  ghostAvailability(track: Track, setup: RaceSetup): GhostAvailability {
    setup = oneRunForOpenRoute(track, setup)
    if (setup.mode === 'boost-practice') return { kind: 'none' }
    if (track.creatorChallenge) {
      return track.creatorChallenge.laps === setup.laps
        ? { kind: 'exact', time: track.creatorChallenge.time }
        : { kind: 'different-setup', setup: { car: track.creatorChallenge.car, laps: track.creatorChallenge.laps } }
    }
    const store = this.dependencies.ghostStore
    if (store?.availability) return store.availability(track, setup)
    const time = store?.load(track, setup)?.time
    return time === undefined ? { kind: 'none' } : { kind: 'exact', time }
  }

  ghostTime(track: Track, setup: RaceSetup): number | null {
    if (setup.mode === 'boost-practice') return null
    setup = oneRunForOpenRoute(track, setup)
    if (track.creatorChallenge) {
      return track.creatorChallenge.laps === setup.laps ? track.creatorChallenge.time : null
    }
    return this.dependencies.ghostStore?.load(track, setup)?.time ?? null
  }

  creatorGhostChallenge(track: Track, setup: RaceSetup, completedRun = false): CreatorGhostChallenge | null {
    setup = oneRunForOpenRoute(track, setup)
    const completed = this.completedGhost
    const run = completedRun
      ? completed?.trackId === track.id && completed.car === setup.car && completed.laps === setup.laps
        ? completed.run : null
      : this.dependencies.ghostStore?.load(track, setup) ?? null
    if (!run || (!completedRun && run.frames.some(frame => frame.cut))) return null
    return decodeCreatorGhostChallenge({ car: run.car, laps: setup.laps, time: run.time, frames: run.frames,
      ...(run.splits ? { splits: run.splits } : {}) }) ?? null
  }

  restart(): void {
    const { track, setup } = this.current
    if (!track || !setup || setup.mode === 'nearby' || this.destroyed) return
    this.start(track, setup)
  }

  stop(): void {
    if (!this.current.state || this.destroyed) return
    this.previousPresentationTick = null
    this.presentationDiscontinuities.clear()
    this.dependencies.feedback.silenceContinuous()
    this.remainder = 0
    this.rivalFinishRemaining = 0
    this.bestGhost = null
    this.completedGhost = null
    this.recording = null
    this.diagnostics = null
    this.timing = new LapTiming()
    this.localCountdownCuePending = false
    this.publish(EMPTY_RACE)
  }

  resetPlayer(): void {
    const state = this.current.state
    if (!state || this.destroyed) return
    const recovered = recoverRacePlayer(state)
    if (recovered === state) return
    this.previousPresentationTick = null
    this.presentationDiscontinuities.clear()
    const before = state.vehicles.find((vehicle) => vehicle.player)
    const after = recovered.vehicles.find((vehicle) => vehicle.player)
    if (!before || !after) return
    this.recording?.recover(before, after, state.elapsed)
    this.diagnostics?.manualReset(recovered, after.id)
    if (this.current.setup?.mode === 'nearby') this.dependencies.nearby?.recovered()
    this.timing.recover()
    this.publish(
      this.buildSnapshot(
        this.current.track,
        this.current.setup,
        recovered,
        this.current.result,
      ),
    )
  }

  setPaused(paused: boolean): void {
    if (this.destroyed) return
    if (paused) this.dependencies.feedback.silenceContinuous()
    const state = this.current.state
    if (!state || state.paused === paused) return
    this.previousPresentationTick = null
    this.presentationDiscontinuities.clear()
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
    if (!state || state.paused || this.destroyed ||
        !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return
    if (state.phase === 'finished') {
      this.advanceFinishingRivals(state, deltaSeconds)
      return
    }
    const nearby = this.current.setup?.mode === 'nearby' ? this.dependencies.nearby : undefined
    // A staged online race must never tick forward before the shared GO arrives.
    if (this.current.setup?.mode === 'nearby' && state.phase === 'countdown' &&
        this.startsAt === undefined) return
    const previouslyMissedGate = state.missedCheckpoint?.gate

    const nearbyElapsed = this.startsAt === undefined ? undefined : (this.monotonicNow() - this.startsAt) / 1000
    let runningTime = deltaSeconds
    let countdownChanged = false
    if (state.phase === 'countdown') {
      const previousCue = countdownCue(state.countdown)
      // Local scenes pass zero time until their first frame has been
      // submitted. Start audio on the first real countdown advance, not
      // during the potentially expensive scene initialization.
      if (this.localCountdownCuePending) {
        this.localCountdownCuePending = false
        this.dependencies.feedback.handle({ type: 'countdown', cue: previousCue })
      }
      const remaining = nearbyElapsed === undefined ? state.countdown - deltaSeconds : -nearbyElapsed
      const countdown = Math.max(0, remaining)
      const cue = countdownCue(countdown)
      if (cue !== previousCue) {
        this.dependencies.feedback.handle({ type: 'countdown', cue })
      }
      runningTime = Math.min(deltaSeconds, Math.max(0, -remaining))
      if (this.startsAt !== undefined) this.nearbyTimingOffset = Math.max(0, -remaining - runningTime)
      state = { ...state, countdown, phase: cue === 'go' ? 'running' : 'countdown' }
      countdownChanged = true
    }

    const retainedTime = Math.min(runningTime, MAX_CATCH_UP)
    // Account for wall time dropped by the catch-up cap before timestamping
    // the retained ticks. A peer cannot gain race time by dropping frames.
    if (nearbyElapsed !== undefined) {
      this.nearbyTimingOffset += runningTime - retainedTime
      // The frame loop can reset its delta when the app resumes. Restore a
      // missed wall-clock interval without reacting to ordinary frame jitter.
      const projectedElapsed = state.elapsed + this.remainder + retainedTime + this.nearbyTimingOffset
      const unreportedTime = nearbyElapsed - projectedElapsed
      if (unreportedTime >= 3 * RACE_TICK_SECONDS) this.nearbyTimingOffset += unreportedTime
    }
    this.remainder += retainedTime
    const events: ReturnType<RaceStep>['events'][number][] = []
    let stepped = false
    let peakShake = 0
    let peakLanding = 0
    let boostIgnited = false
    let nearbyFinishTime: number | undefined
    while (state.phase === 'running' && this.remainder + 1e-10 >= RACE_TICK_SECONDS) {
      const before = state.vehicles.find((vehicle) => vehicle.player)
      const tickInput = stepped ? { ...input, boostRequested: false } : input
      const next = this.step(state, tickInput, RACE_TICK_SECONDS, this.dependencies.random)
      this.previousPresentationTick = state
      this.presentationDiscontinuities = new Set(next.events.flatMap((event) =>
        event.type === 'vehicle-recovered' ? [event.vehicleId] : [],
      ))
      state = next.state
      const player = state.vehicles.find((vehicle) => vehicle.player)
      if (before?.driftBoost?.phase !== 'active' && player?.driftBoost?.phase === 'active') {
        boostIgnited = true
      }
      peakShake = Math.max(peakShake, state.cameraHints.shake)
      events.push(...next.events)
      if (player?.manualRecoveryUntilTick === state.tick && state.phase === 'running') {
        this.dependencies.feedback.handle({ type: 'countdown', cue: 'go' })
      }
      if (before && player && player.lap === before.lap && player.nextSector < before.nextSector) {
        this.timing.abandonLap(player.lap)
      }
      let playerGateIndex = 0
      for (const event of next.events) {
        if (event.type === 'vehicle-recovered' && event.vehicleId === player?.id) {
          this.timing.recover()
          nearby?.recovered()
          if (before && player) this.recording?.recover(before, player, state.elapsed)
        } else if (event.type === 'gate-crossed' && event.vehicleId === player?.id) {
          const time = this.startsAt === undefined ? event.time :
            event.time + this.nearbyTimingOffset -
              (1 - (next.playerGateFractions?.[playerGateIndex++] ?? 1)) * RACE_TICK_SECONDS
          this.timing.accept(event.lap, event.gate, time)
          if (this.startsAt !== undefined && state.phase === 'finished' &&
              event.gate === (state.timingGates?.length ?? 0) + 1) nearbyFinishTime = time
        }
      }
      this.diagnostics?.record(state, next.events, tickInput)
      if (player && state.phase !== 'finished') this.recording?.sample(player, state.elapsed)
      if (before && player && !before.grounded && player.grounded) {
        peakLanding = Math.max(peakLanding, player.landingIntensity)
      }
      this.remainder = Math.max(0, this.remainder - RACE_TICK_SECONDS)
      stepped = true
    }
    if (!stepped && !countdownChanged) return
    if (state.phase === 'running' && state.missedCheckpoint &&
        state.missedCheckpoint.gate !== previouslyMissedGate) {
      this.dependencies.feedback.handle({ type: 'ui', emphasis: 'danger' })
    }
    if (stepped) state = { ...state, cameraHints: { ...state.cameraHints, shake: peakShake } }
    if (state.phase === 'finished') this.remainder = 0
    const terminalEvent = events.find((event) => event.type === 'race-finished')
    const resultState = terminalEvent?.reason === 'water' ? this.withoutPlayerFinish(state) : state
    let result = resultState.phase === 'finished'
      ? (this.current.result ?? createRaceResult({
        track: this.current.track, setup: this.current.setup, state: resultState,
        terminalReason: terminalEvent?.reason,
        scoreStore: this.dependencies.scoreStore,
        now: this.now,
        splits: this.timing.accepted,
        bestGhostTime: this.bestGhost?.time,
      }))
      : null
    if (nearby) {
      const player = resultState.vehicles.find((vehicle) => vehicle.player)
      if (player && !result) nearby.update(player, resultState)
      if (player && result && !this.current.result) nearby.captureFinalFrame(player, resultState)
      if (result && !this.current.result) {
        if (result.playerTime !== null) {
          result = { ...result, playerTime: nearbyFinishTime ?? result.playerTime + this.nearbyTimingOffset }
        }
        nearby.finish(result.playerTime)
      }
    }
    if (stepped) routeRaceFeedback(this.dependencies.feedback, resultState, events, input, peakLanding, boostIgnited)
    if (result && !this.current.result) {
      if (result.outcome === 'finished' && resultState.vehicles.some(isRivalRacing)) {
        this.rivalFinishRemaining = RIVAL_FINISH_SECONDS
        result = { ...result, rivalsFinishing: true }
      }
      const track = this.current.track
      const setup = this.current.setup
      const player = resultState.vehicles.find((vehicle) => vehicle.player)
      if (track && setup && setup.mode !== 'nearby' && setup.mode !== 'boost-practice' && player && this.dependencies.ghostStore &&
          result.outcome === 'finished' && result.playerTime !== null) {
        const frames = this.recording?.finish(player, resultState.elapsed)
        if (frames) {
          const splits = this.timing.complete(setup.laps)
          this.completedGhost = { trackId: track.id, car: setup.car, laps: setup.laps,
            run: { car: setup.car, time: result.playerTime, frames,
              ...(splits ? { splits } : {}) } }
          const previous = this.dependencies.ghostStore.load(track, setup)
          const saved = this.dependencies.ghostStore.record(track, setup, result.playerTime, frames, splits)
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
      this.recording = null
    }
    const nextSnapshot = this.buildSnapshot(this.current.track, this.current.setup, resultState, result)
    const previous = this.current.telemetry
    const current = nextSnapshot.telemetry
    if (
      (nextSnapshot.setup?.mode === 'normal' ||
        (nextSnapshot.setup?.mode === 'nearby' && previous.positionKnown && current.positionKnown)) &&
      previous.phase === 'running' &&
      current.phase === 'running' &&
      current.elapsed >= 0.7 &&
      current.vehicleCount > 1 &&
      previous.position !== current.position &&
      current.elapsed - this.lastPositionCueAt >= 0.65
    ) {
      this.lastPositionCueAt = current.elapsed
      this.dependencies.feedback.handle({
        type: 'position-change',
        direction: current.position < previous.position ? 'gain' : 'loss',
        place: current.position,
      })
    }
    this.publish(nextSnapshot)
  }

  private advanceFinishingRivals(state: RaceState, deltaSeconds: number): void {
    const { track, setup, result } = this.current
    if (!result || this.rivalFinishRemaining === 0) return
    // Spend only capped simulation time so stalls do not burn the finish window.
    const remainingTime = Math.min(deltaSeconds, MAX_CATCH_UP, this.rivalFinishRemaining)
    this.rivalFinishRemaining -= remainingTime
    if (this.rivalFinishRemaining < 1e-10) this.rivalFinishRemaining = 0
    this.remainder += remainingTime
    if (this.remainder + 1e-10 < RACE_TICK_SECONDS && this.rivalFinishRemaining > 0) return
    while (this.remainder + 1e-10 >= RACE_TICK_SECONDS) {
      state = stepFinishingRivals(state, this.dependencies.random)
      this.diagnostics?.record(state, [])
      this.remainder = Math.max(0, this.remainder - RACE_TICK_SECONDS)
      if (!state.vehicles.some(isRivalRacing)) {
        this.rivalFinishRemaining = 0
        break
      }
    }
    const snapshot = this.buildSnapshot(track, setup, state, result)
    const rivalsFinishing = this.rivalFinishRemaining > 0
    const standingsChanged = snapshot.standings.some((standing, index) => {
      const before = result.standings[index]
      return standing.id !== before?.id || standing.finishTime !== before.finishTime
    })
    this.publish(rivalsFinishing === result.rivalsFinishing && !standingsChanged
      ? snapshot
      : { ...snapshot, result: { ...result, standings: snapshot.standings, rivalsFinishing } })
  }

  nearbyGhosts(): readonly GhostPose[] {
    return this.current.setup?.mode === 'nearby' ? this.dependencies.nearby?.remotePoses() ?? [] : []
  }

  snapshot(): RaceSessionSnapshot {
    return this.current
  }

  presentationState(): RaceState | null {
    const state = this.current.state
    if (!state || state.phase !== 'running' || state.paused || !this.previousPresentationTick) return state
    return interpolateRaceState(
      this.previousPresentationTick,
      state,
      this.remainder / RACE_TICK_SECONDS,
      this.presentationDiscontinuities,
    )
  }

  diagnosticsReport(): RaceDiagnosticsReport | null {
    const { track, setup, result } = this.current
    return track && setup && this.diagnostics
      ? this.diagnostics.report(track, setup, result) : null
  }

  subscribe(listener: (snapshot: RaceSessionSnapshot) => void): Unsubscribe {
    if (this.destroyed) return () => undefined
    return this.events.subscribe(listener)
  }

  destroy(): void {
    if (this.destroyed) return
    this.dependencies.feedback.silenceContinuous()
    this.destroyed = true
    this.previousPresentationTick = null
    this.presentationDiscontinuities.clear()
    this.diagnostics = null
    this.events.clear()
  }

  private buildSnapshot(
    track: Track | null,
    setup: RaceSetup | null,
    state: RaceState,
    result: RaceResult | null,
  ): RaceSessionSnapshot {
    const ranked = rankVehicles(state.vehicles, state.path.points.length, state.startPathIndex, state.reversed, normalizeRouteKind(track?.routeKind))
    const standings = ranked.map((vehicle, index) =>
      toRaceStanding(vehicle, index),
    )
    const player = ranked.find((vehicle) => vehicle.player)
    const nearbyPosition = setup?.mode === 'nearby' && player
      ? this.dependencies.nearby?.livePosition?.(player, state) : null
    const latestSplit = this.timing.accepted.at(-1)
    const elapsed = result?.playerTime ?? (setup?.mode === 'nearby' && state.phase === 'running'
      ? this.dependencies.nearby?.synchronizedElapsed?.() ?? state.elapsed : state.elapsed)
    return {
      runId: this.runId,
      track,
      setup,
      state,
      standings,
      result,
      ghost: setup?.mode === 'ghost' && this.bestGhost ? ghostPoseAt(this.bestGhost, elapsed) : null,
      ...(setup?.mode === 'ghost' && this.bestGhost ? { ghostTime: this.bestGhost.time } : {}),
      telemetry: {
        routeKind: normalizeRouteKind(track?.routeKind),
        routeProgress: player ? Math.max(0, Math.min(1, raceProgress(player, state.path.points.length, state.startPathIndex, state.reversed, normalizeRouteKind(track?.routeKind)) / Math.max(1, state.path.points.length - 1))) : 0,
        ...(latestSplit ? { latestSplit } : {}),
        finishGate: (state.timingGates?.length ?? 0) + 1,
        phase: state.phase,
        waitingForStart: setup?.mode === 'nearby' && state.phase === 'countdown' && this.startsAt === undefined,
        countdown: state.countdown,
        elapsed,
        position: nearbyPosition?.position ?? (player ? ranked.indexOf(player) + 1 : 1),
        positionKnown: setup?.mode !== 'nearby' || nearbyPosition != null,
        vehicleCount: nearbyPosition?.vehicleCount ?? state.vehicles.length,
        lap: player?.lap ?? 0,
        totalLaps: state.totalLaps,
        currentLapTime: this.timing.currentLap(elapsed),
        bestLapTime: this.timing.bestLap,
        ghostGap: this.timing.gap,
      },
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

  private publish(snapshot: RaceSessionSnapshot): void {
    this.current = snapshot
    this.events.publish(snapshot)
  }
}
