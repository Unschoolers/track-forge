import type { CarId, LightingMode, Track } from '@/domain/model'
import { normalizeRouteKind } from '@/domain/model'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import type { PlayerIdentity } from './playerIdentity'
import type { NearbyLobby } from './nearbyLobby'
import type { NearbyPoseSync, PoseRacer } from './nearbyPoseSync'
import type { NearbyProgressSync } from './nearbyProgressSync'
import { NearbyNetworkTelemetry } from './nearbyNetworkTelemetry'
import { NearbyReplayTrace, type NearbyTraceRival } from './nearbyReplayTrace'

interface DiagnosticContext {
  readonly phase: string
  readonly purpose: 'race' | 'share'
  readonly role: 'host' | 'guest' | null
  readonly round: number
  readonly cupTotal: number
  readonly cupIndex: number
  readonly slot: number
  readonly hostId: string | null
  readonly course: { readonly track: Track; readonly car: CarId; readonly lighting: LightingMode; readonly laps: number } | null
  readonly localCar: CarId
  readonly localIdentity: PlayerIdentity
  readonly localDisplayName: string | undefined
  readonly rooms: number
  readonly pendingPairs: number
  readonly guests: ReadonlyMap<string, number>
  readonly racers: ReadonlyMap<number, PoseRacer>
  readonly lobby: Pick<NearbyLobby, 'peer' | 'peerCount'>
  readonly progressSync: Pick<NearbyProgressSync, 'latest'>
}

interface DiagnosticCounters {
  readonly poseCounts: NearbyPoseSync['counts']
  readonly progressSendFailures: number
  readonly targetPoseHz: number
}

/** Owns bounded diagnostic state, not room membership or race decisions. */
export class NearbyRaceDiagnostics {
  private readonly timeline: Record<string, unknown>[] = []
  private diagnosticStart = 0
  private diagnosticStartedAtUtc: string | null = null
  private networkTelemetry = new NearbyNetworkTelemetry()
  private readonly replayTrace = new NearbyReplayTrace()
  private lastRaceDiagnostics: Record<string, unknown> | null = null
  private lastFailure: Record<string, unknown> | null = null
  private static readonly TIMELINE_LIMIT = 100

  constructor(private readonly now: () => number, private readonly context: () => DiagnosticContext) {}

  begin(): void {
    this.timeline.length = 0
    this.diagnosticStart = this.now()
    this.diagnosticStartedAtUtc = new Date().toISOString()
    this.lastRaceDiagnostics = null
    this.replayTrace.reset()
    this.networkTelemetry = new NearbyNetworkTelemetry()
    this.lastFailure = null
  }

  finishRound(): void {
    this.finishRoom()
    this.networkTelemetry = new NearbyNetworkTelemetry()
  }

  finishRoom(): void {
    this.lastRaceDiagnostics = this.captureRaceDiagnostics() ?? this.lastRaceDiagnostics
    this.replayTrace.reset()
  }

  recordPose(slot: number, sequence: number, accepted: boolean, at: number): void {
    this.networkTelemetry.recordPose(slot, sequence, accepted, at)
  }

  recordProgress(slot: number, sequence: number, accepted: boolean, at: number): void {
    this.networkTelemetry.recordProgress(slot, sequence, accepted, at)
  }

  record(event: string, details: Record<string, unknown> = {}): void {
    const context = this.context()
    this.timeline.push({ atMs: Math.max(0, Math.round(this.now() - this.diagnosticStart)), event,
      phase: context.phase, counts: this.counts(context), ...details })
    if (this.timeline.length > NearbyRaceDiagnostics.TIMELINE_LIMIT) this.timeline.shift()
  }

  failure(source: string, error: string): void {
    const context = this.context()
    this.lastFailure = { source, error, phase: context.phase, counts: this.counts(context) }
    this.record('failure', { source, error })
  }

  report(counters: DiagnosticCounters): Record<string, unknown> {
    const context = this.context()
    return {
      version: 2,
      exportedAtUtc: new Date().toISOString(),
      startedAtUtc: this.diagnosticStartedAtUtc,
      monotonicStartedAtMs: this.diagnosticStartedAtUtc === null ? null : this.diagnosticStart,
      role: context.role,
      phase: context.phase,
      counts: this.counts(context),
      timeline: this.timeline.map(entry => ({ ...entry })),
      ...counters,
      race: this.captureRaceDiagnostics() ?? this.lastRaceDiagnostics,
      lastFailure: this.lastFailure && { ...this.lastFailure },
    }
  }

  private counts(context: DiagnosticContext) {
    return { rooms: context.rooms, pendingPairs: context.pendingPairs, guests: context.guests.size,
      ready: context.lobby.peerCount, racers: context.racers.size }
  }

  captureTraceFrame(vehicle: RaceVehicle, state: RaceState, force = false): void {
    const now = this.now()
    if (!this.replayTrace.shouldRecord(now, force)) return
    const context = this.context()
    const rivals: NearbyTraceRival[] = []
    for (const [slot, racer] of context.racers) {
      if (slot === context.slot) continue
      const pose = racer.left ? null : racer.ghost.peekPose(now)
      rivals.push(pose ? {
        slot, car: racer.ghost.car, visible: true,
        x: pose.x, y: pose.y, z: pose.z, angle: pose.angle,
        observedAtMs: pose.t, progress: context.progressSync.latest(slot),
      } : { slot, car: racer.ghost.car, visible: false })
    }
    this.replayTrace.record(now, {
      elapsed: state.elapsed,
      local: {
        slot: context.slot, car: vehicle.car, x: vehicle.x, y: vehicle.y, z: vehicle.z,
        angle: vehicle.angle, lap: vehicle.lap, sector: vehicle.nextSector,
        pathIndex: vehicle.pathIndex, speed: vehicle.speed,
      },
      rivals,
      ...(state.missedCheckpoint ? { missedGate: state.missedCheckpoint.gate } : {}),
    }, force)
  }

  /** Materialize diagnostics only when exported or leaving a race. Never in the render loop. */
  private captureRaceDiagnostics(): Record<string, unknown> | null {
    const context = this.context()
    if (context.purpose !== 'race' || (!context.course && !context.racers.size && !context.lobby.peerCount)) return null
    const now = this.now()
    const slots = new Set<number>([context.slot])
    for (const slot of context.guests.values()) slots.add(slot)
    if (context.role === 'guest' && context.hostId) slots.add(0)
    for (const slot of context.racers.keys()) slots.add(slot)
    const streams = this.networkTelemetry.snapshot(now, this.diagnosticStart)
    const readyBySlot = new Map<number, { car: CarId; identity: PlayerIdentity; name?: string }>()
    for (const [endpoint, slot] of context.guests) {
      const ready = context.lobby.peer(endpoint)
      if (ready) readyBySlot.set(slot, ready)
    }
    return {
      round: context.round, cupIndex: context.cupTotal ? context.cupIndex : null,
      elapsedMs: Math.round(Math.max(0, now - this.diagnosticStart)),
      localSlot: context.slot,
      track: context.course ? {
        id: context.course.track.id, name: context.course.track.name,
        revision: context.course.track.raceRevision ?? null,
        routeKind: normalizeRouteKind(context.course.track.routeKind),
        pointCount: context.course.track.points?.length ?? null,
        trackShapeValid: Array.isArray(context.course.track.points),
        lighting: context.course.lighting, laps: context.course.laps,
      } : null,
      /** User-requested export: compact control geometry + observed car positions.
       * No endpoint IDs, raw Nearby payloads, or player names in the trace.
       */
      trace: {
        ...this.replayTrace.snapshot(),
        // Diagnostics also run on a failed/unvalidated room setup, so the
        // authored point list must not be assumed valid at this boundary.
        controlPoints: context.course && Array.isArray(context.course.track.points)
          ? context.course.track.points.map(point => [point.x, point.y]) : [],
      },
      players: [...slots].sort((a, b) => a - b).map(slot => {
        const racer = context.racers.get(slot)
        const prepared = readyBySlot.get(slot)
        const local = slot === context.slot
        const identity = racer?.identity ?? prepared?.identity ?? (local ? context.localIdentity : null)
        return {
          id: `slot-${slot}`, slot, local,
          // A slot is stable across devices within a race. Raw Nearby endpoint
          // identifiers and pairing codes are intentionally not exported.
          connectionRole: local ? 'local' : slot === 0 ? 'host' : 'guest',
          name: racer?.name ?? prepared?.name ?? (local ? context.localDisplayName : undefined) ?? null,
          car: racer?.ghost.car ?? prepared?.car ?? (local ? (context.role === 'host' ? context.course?.car ?? context.localCar : context.localCar) : null),
          icon: identity?.icon ?? null, color: identity?.color ?? null,
          finishedSeconds: racer?.time ?? null,
          finished: typeof racer?.time === 'number',
          left: racer?.left ?? false,
          receive: streams[slot],
          presentation: !local && racer ? racer.ghost.presentationDiagnostics() : null,
        }
      }),
    }
  }
}
