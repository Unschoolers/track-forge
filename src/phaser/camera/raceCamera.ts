import { clamp } from '@/domain/geometry/math'
import type { Vector2 } from '@/domain/model'
import type { RaceCameraHints } from '@/domain/race/raceState'

export interface RaceCameraState {
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly zoom: number
  readonly shake: Vector2
}

export interface RaceCameraOptions {
  readonly dynamicZoom: boolean
  readonly steering: number
}

/**
 * Race framing lives here so camera distance can be tuned without touching the
 * follow/rotation algorithm. Higher zoom values move the camera closer.
 */
export const RACE_CAMERA_TUNING = {
  initialZoom: 1.2,
  normalStraightZoom: 1.2,
  fastestStraightZoom: 1.16,
  cornerZoom: 1.28,
  fixedZoom: 1.18,
  minimumZoom: 1.14,
  maximumZoom: 1.3,
  zoomInResponse: 1.65,
  zoomOutResponse: 0.78,
} as const

export function createRaceCamera(
  initial: Pick<RaceCameraState, 'x' | 'y' | 'angle'>,
): RaceCameraState {
  return {
    ...initial,
    zoom: RACE_CAMERA_TUNING.initialZoom,
    shake: { x: 0, y: 0 },
  }
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export function advanceRaceCamera(
  camera: RaceCameraState,
  hints: RaceCameraHints,
  options: RaceCameraOptions,
  deltaSeconds: number,
): RaceCameraState {
  const dt = clamp(deltaSeconds, 0, 1)
  const positionFollow = 1 - Math.exp(-dt * 7.2)
  const headingError = wrapAngle(hints.roadAngle - camera.angle)
  const rotationActive =
    Math.abs(options.steering) > 0.08 ||
    Math.abs(headingError) > 0.14 ||
    hints.upcomingCurve > 0.2
  const rotationFollow = rotationActive ? 1 - Math.exp(-dt * 4) : 0
  const curveAmount = clamp((hints.upcomingCurve - 0.055) / 0.34, 0, 1)
  const speedAmount = clamp((hints.speed - 80) / 220, 0, 1)
  // Preserve useful look-ahead without making the car feel miniature. Faster
  // straights pull back modestly; corners move closer so vehicle attitude and
  // drift remain readable.
  const straightZoom =
    RACE_CAMERA_TUNING.normalStraightZoom +
    (RACE_CAMERA_TUNING.fastestStraightZoom -
      RACE_CAMERA_TUNING.normalStraightZoom) *
      speedAmount
  const dynamicTarget =
    straightZoom +
    (RACE_CAMERA_TUNING.cornerZoom - straightZoom) * curveAmount
  const targetZoom = options.dynamicZoom
    ? dynamicTarget
    : RACE_CAMERA_TUNING.fixedZoom
  const zoomFollow = options.dynamicZoom
    ? 1 -
      Math.exp(
        -dt *
          (targetZoom > camera.zoom
            ? RACE_CAMERA_TUNING.zoomInResponse
            : RACE_CAMERA_TUNING.zoomOutResponse),
      )
    : 1
  return {
    x: camera.x + (hints.target.x - camera.x) * positionFollow,
    y: camera.y + (hints.target.y - camera.y) * positionFollow,
    angle: camera.angle + headingError * rotationFollow,
    zoom: clamp(
      camera.zoom + (targetZoom - camera.zoom) * zoomFollow,
      RACE_CAMERA_TUNING.minimumZoom,
      RACE_CAMERA_TUNING.maximumZoom,
    ),
    shake: {
      x: hints.shake,
      y: hints.shake * 0.5,
    },
  }
}
