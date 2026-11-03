import { TRACK_CLOSE_DISTANCE } from '@/domain/config'
import {
  isLightingMode,
  isSurfaceId,
  type Track,
  type Vector2,
} from '@/domain/model'
import { EDITOR_LIMITS } from '@/domain/editor/editorGeometry'

export type TrackValidationCode =
  | 'ready'
  | 'too-few-points'
  | 'open-loop'
  | 'too-short'
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

  if (track.points.length < 9) {
    return {
      ready: false,
      code: 'too-few-points',
      message: 'Add more road to complete the circuit',
    }
  }

  const first = track.points[0]
  const last = track.points.at(-1)
  if (
    first === undefined ||
    last === undefined ||
    Math.hypot(first.x - last.x, first.y - last.y) >= TRACK_CLOSE_DISTANCE
  ) {
    return {
      ready: false,
      code: 'open-loop',
      message: 'Close the circuit to make it race ready',
    }
  }

  if (totalLength < EDITOR_LIMITS.minimumTrackLength) {
    return {
      ready: false,
      code: 'too-short',
      message: 'Track is too short',
    }
  }

  return { ready: true, code: 'ready', message: 'Track ready' }
}
