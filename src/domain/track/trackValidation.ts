import { TRACK_CLOSE_DISTANCE } from '@/domain/config'
import {
  normalizeRouteKind,
  isLightingMode,
  isSurfaceId,
  type Track,
  type Vector2,
} from '@/domain/model'
import { EDITOR_LIMITS } from '@/domain/editor/editorGeometry'
import { MAX_ROAD_CONTROL_LENGTH, roadControlLength } from '@/domain/track/roadLength'

export type TrackValidationCode =
  | 'ready'
  | 'too-few-points'
  | 'open-loop'
  | 'too-short'
  | 'road-too-long'
  | 'missing-checkpoints'
  | 'invalid-data'

export interface TrackValidationResult {
  readonly ready: boolean
  readonly code: TrackValidationCode
  readonly message: string
}

function isFiniteVector(value: Vector2): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
}

export function validateTrack(
  track: Track,
  totalLength: number,
): TrackValidationResult {
  if (
    track.name.trim().length === 0 ||
    !isLightingMode(track.lighting) ||
    !track.points.every(
      (point) => isFiniteVector(point) && isSurfaceId(point.surface),
    ) ||
    !track.trees.every(isFiniteVector)
  ) {
    return {
      ready: false,
      code: 'invalid-data',
      message: 'Track data is invalid',
    }
  }

  const pointToPoint = normalizeRouteKind(track.routeKind) === 'point-to-point'
  if (track.points.length < (pointToPoint ? 2 : 9)) {
    return {
      ready: false,
      code: 'too-few-points',
      message: pointToPoint ? 'Add more road to complete the route' : 'Add more road to complete the circuit',
    }
  }

  if (roadControlLength(track) > MAX_ROAD_CONTROL_LENGTH) {
    return { ready: false, code: 'road-too-long', message: 'Road is too long. Shorten it to race.' }
  }

  const first = track.points[0]
  const last = track.points.at(-1)
  if (
    !pointToPoint && (first === undefined ||
    last === undefined ||
    Math.hypot(first.x - last.x, first.y - last.y) >= TRACK_CLOSE_DISTANCE)
  ) {
    return {
      ready: false,
      code: 'open-loop',
      message: 'Close the circuit to make it race ready',
    }
  }

  if (pointToPoint && first && last && first.x === last.x && first.y === last.y) {
    return { ready: false, code: 'invalid-data', message: 'Start and finish must be distinct' }
  }

  if (totalLength < EDITOR_LIMITS.minimumTrackLength) {
    return {
      ready: false,
      code: 'too-short',
      message: 'Track is too short',
    }
  }

  if (!track.recoveryCheckpoints?.some(ratio => Number.isFinite(ratio) && ratio > 0 && ratio < 1)) {
    return { ready: false, code: 'missing-checkpoints', message: 'Incomplete track · Add a checkpoint in the editor' }
  }

  return { ready: true, code: 'ready', message: 'Track ready' }
}
