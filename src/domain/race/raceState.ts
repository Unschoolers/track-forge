import type {
  CarId,
  DifficultyId,
  SurfaceId,
  Vector2,
  RouteKind,
} from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'
import type { AiDriverState } from '@/domain/race/ai/aiState'
import type { RaceEffectsState } from '@/domain/race/effects'
import type { SceneryColliders } from '@/domain/race/sceneryCollisions'

export type CountdownCue = 3 | 2 | 1 | 'go'

export function countdownCue(seconds: number): CountdownCue {
  if (seconds > 2) return 3
  if (seconds > 1) return 2
  return seconds > Number.EPSILON ? 1 : 'go'
}

export interface RaceVehicle {
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
  /** Absolute world-space height above the base datum, in world units. */
  readonly z: number
  readonly verticalVelocity: number
  readonly grounded: boolean
  readonly suspensionCompression: number
  readonly landingIntensity: number
  readonly contactLoad: number
  readonly structureRunId: string | null
  readonly nextSector: 1 | 2 | 3 | 4
  readonly lap: number
  readonly recoveryCheckpoint?: number | null
  readonly damage: number
  readonly damageLimit: number
  readonly damageCooldown: number
  readonly wrecked: boolean
  readonly currentSurface: SurfaceId | 'grass'
  readonly surfaceGrip?: number
  readonly onCurb: boolean
  readonly stuckDuration: number
  readonly finishedAt: number | null
  /** Arcade fallback: suppress repeat water resets until safe grounded support. */
  readonly waterRecoveryProtected?: boolean
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
  readonly routeKind?: RouteKind
  readonly vehicles: readonly RaceVehicle[]
  readonly difficulty: DifficultyId
  readonly handling?: 'arcade' | 'simulation'
  readonly totalLaps: number
  readonly startPathIndex: number
  readonly recoveryCheckpoints?: readonly number[]
  readonly sceneryColliders?: SceneryColliders
  readonly reversed: boolean
  /** Number of running simulation updates completed since this race started. */
  readonly tick: number
  readonly elapsed: number
  readonly phase: RacePhase
  readonly countdown: number
  readonly paused: boolean
  readonly activeContacts: readonly string[]
  readonly cameraHints: RaceCameraHints
  readonly effects: RaceEffectsState
}

export type RacePhase = 'countdown' | 'running' | 'finished'
export type RaceOutcome = 'finished' | 'wrecked' | 'water'

export interface DriverInput {
  readonly steering: number
  readonly throttle: number
  readonly braking: boolean
}
