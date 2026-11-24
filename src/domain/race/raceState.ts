import type {
  CarId,
  DifficultyId,
  SurfaceId,
  Vector2,
  RouteKind,
} from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'
import type { AiDriverState, RacingLine } from '@/domain/race/ai/aiState'
import type { CarDrivingProfile } from '@/domain/race/ai/aiCarDrivingProfiles'
import type { CarPassingPolicy } from '@/domain/race/ai/aiCarPassingPolicies'
import type { RaceEffectsState } from '@/domain/race/effects'

export type CountdownCue = 3 | 2 | 1 | 'go'

export function countdownCue(seconds: number): CountdownCue {
  if (seconds > 2) return 3
  if (seconds > 1) return 2
  return seconds > Number.EPSILON ? 1 : 'go'
}

export interface RaceVehicle {
  readonly racingLine?: RacingLine
  readonly id: string
  readonly car: CarId
  readonly player: boolean
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly vx: number
  readonly vy: number
  readonly yawRate: number
  readonly speed: number
  readonly slip: number
  readonly braking: boolean
  readonly brakePressure?: number
  readonly lane: number
  readonly ai: AiDriverState | null
  readonly aiPace: number
  readonly pathIndex: number
  readonly pathDistance: number
  /** Previous followed road while a displaced car reacquires another arm. */
  readonly recoveryAnchorIndex?: number | undefined
  readonly recoveryReacquiredIndex?: number | undefined
  /** Last safe grounded road contact, independent of authored markers. */
  readonly lastRoadContactIndex?: number | undefined
  /** Absolute world-space height above the base datum, in world units. */
  readonly z: number
  readonly verticalVelocity: number
  readonly grounded: boolean
  readonly suspensionCompression: number
  readonly landingIntensity: number
  readonly contactLoad: number
  readonly structureRunId: string | null
  readonly nextSector: number
  readonly lap: number
  readonly recoveryCheckpoint?: number | null
  /** Manual recovery releases controls after this running simulation tick. */
  readonly manualRecoveryUntilTick?: number
  /** Seconds since a player fell off elevated road support; clears after recovery. */
  readonly bridgeFallSeconds?: number | undefined
  readonly currentSurface: SurfaceId | 'grass'
  readonly surfaceGrip?: number
  readonly onCurb: boolean
  readonly stuckDuration: number
  /** Continuous grounded off-road time before an AI needs a forced reset. */
  readonly aiOffRoadSeconds?: number
  readonly finishedAt: number | null
  /** Arcade fallback: suppress repeat water resets until safe grounded support. */
  readonly waterRecoveryProtected?: boolean
}

export const MANUAL_RECOVERY_TICKS = 30

export function manualRecoveryTicksRemaining(vehicle: RaceVehicle | undefined, tick: number): number {
  return Math.max(0, (vehicle?.manualRecoveryUntilTick ?? tick) - tick)
}

export interface RaceCameraHints {
  readonly target: Vector2
  /** Player position followed by route points inside the approach preview. */
  readonly preview?: readonly Vector2[]
  readonly roadAngle: number
  /** Camera preview follows travel opposite the configured course direction. */
  readonly followingOppositeTravel?: boolean
  /** Time spent consistently moving toward a change in camera travel direction. */
  readonly directionChangeSeconds?: number
  readonly upcomingCurve: number
  readonly speed: number
  readonly shake: number
}

export interface RaceState {
  readonly path: RoadPath
  readonly missedCheckpoint?: { readonly gate: number; readonly remainingSeconds: number; readonly position: Vector2 } | undefined
  readonly routeKind?: RouteKind
  readonly vehicles: readonly RaceVehicle[]
  /** Per-race, immutable driver overrides for deterministic offline diagnostics. */
  readonly aiProfileOverrides?: Readonly<Partial<Record<CarId, CarDrivingProfile>>>
  /** Race-local passing parameters, independent of each car's solo steering. */
  readonly aiPassingPolicyOverrides?: Readonly<Partial<Record<CarId, CarPassingPolicy>>>
  /** Offline A/B benchmark: force previous Arcade AI↔AI traffic envelopes. */
  readonly aiAiTrafficMode?: 'legacy' | 'compact'
  /** Optional controlled-AI race speed caps, keyed by vehicle ID; offline duels only. */
  readonly aiVehicleSpeedLimits?: Readonly<Record<string, number>>
  readonly difficulty: DifficultyId
  readonly totalLaps: number
  readonly startPathIndex: number
  readonly recoveryCheckpoints?: readonly number[]
  /** Author-placed timing checkpoint road samples, in driving order. No implicit quarters. */
  readonly timingGates?: readonly number[]
  readonly reversed: boolean
  /** Number of running simulation updates completed since this race started. */
  readonly tick: number
  readonly elapsed: number
  readonly phase: RacePhase
  readonly countdown: number
  readonly paused: boolean
  readonly cameraHints: RaceCameraHints
  readonly effects: RaceEffectsState
}

export type RacePhase = 'countdown' | 'running' | 'finished'
export type RaceOutcome = 'finished' | 'water'

export interface DriverInput {
  readonly steering: number
  readonly throttle: number
  readonly braking: boolean
  /** AI-only proportional service brake. Player controls retain their own brake timing. */
  readonly brakePressure?: number
}
