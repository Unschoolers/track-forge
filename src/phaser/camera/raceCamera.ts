import { ROAD_GEOMETRY } from '@/domain/config'
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
  readonly viewport?: { readonly width: number; readonly height: number }
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
  minimumZoom: 1.02,
  maximumZoom: 1.3,
  zoomInResponse: 1.65,
  maximumRotationRadiansPerSecond: 2.3,
  zoomOutResponse: 4.2,
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

function framePreview(
  preview: readonly Vector2[],
  viewport: NonNullable<RaceCameraOptions['viewport']>,
  angle: number,
  preferredZoom: number,
): { readonly target: Vector2; readonly zoom: number } | undefined {
  const player = preview[0]
  if (!player || viewport.width <= 0 || viewport.height <= 0) return undefined
  const forwardX = Math.cos(angle)
  const forwardY = Math.sin(angle)
  let near = 0
  let far = 0
  let left = 0
  let right = 0
  for (const point of preview) {
    const dx = point.x - player.x
    const dy = point.y - player.y
    const along = dx * forwardX + dy * forwardY
    const across = dy * forwardX - dx * forwardY
    near = Math.min(near, along)
    far = Math.max(far, along)
    left = Math.min(left, across)
    right = Math.max(right, across)
  }
  // Reserve screen space for the HUD and pedals, including short landscape layouts.
  const halfWidth = Math.max(1, viewport.width / 2 - 16)
  const halfHeight = viewport.height / 2 - Math.min(104, viewport.height * 0.23)
  const zoom = Math.max(RACE_CAMERA_TUNING.minimumZoom, Math.min(
    preferredZoom,
    2 * halfWidth / (right - left + ROAD_GEOMETRY.edgeWidth),
    2 * halfHeight / (far - near + ROAD_GEOMETRY.edgeWidth),
  ))
  const alongRoom = Math.max(0, halfHeight - 24) / zoom
  const acrossRoom = Math.max(0, halfWidth - 24) / zoom
  const along = clamp((near + far) / 2, -alongRoom, alongRoom)
  const across = clamp((left + right) / 2, -acrossRoom, acrossRoom)
  return {
    target: {
      x: player.x + along * forwardX - across * forwardY,
      y: player.y + along * forwardY + across * forwardX,
    },
    zoom,
  }
}

export function advanceRaceCamera(
  camera: RaceCameraState,
  hints: RaceCameraHints,
  options: RaceCameraOptions,
  deltaSeconds: number,
): RaceCameraState {
  const dt = clamp(deltaSeconds, 0, 1)
  const positionFollow = 1 - Math.exp(-dt * 9.2)
  const headingError = wrapAngle(hints.roadAngle - camera.angle)
  const rotationActive =
    Math.abs(options.steering) > 0.08 ||
    Math.abs(headingError) > 0.14 ||
    hints.upcomingCurve > 0.2
  const rotationFollow = rotationActive
    ? 1 - Math.exp(-dt * (Math.abs(options.steering) > 0.08 ? 6.4 : 5.2))
    : 0
  // Never spin the world instantly when path sampling changes branches.
  const angle = camera.angle + clamp(
    headingError * rotationFollow,
    -RACE_CAMERA_TUNING.maximumRotationRadiansPerSecond * dt,
    RACE_CAMERA_TUNING.maximumRotationRadiansPerSecond * dt,
  )
  const curveAmount = clamp((hints.upcomingCurve - 0.055) / 0.34, 0, 1)
  const speedAmount = clamp((hints.speed - 80) / 220, 0, 1)
  // Move closer for drift readability when the upcoming road still fits.
  const straightZoom =
    RACE_CAMERA_TUNING.normalStraightZoom +
    (RACE_CAMERA_TUNING.fastestStraightZoom -
      RACE_CAMERA_TUNING.normalStraightZoom) *
      speedAmount
  const dynamicTarget =
    straightZoom +
    (RACE_CAMERA_TUNING.cornerZoom - straightZoom) * curveAmount
  const framing = options.dynamicZoom && hints.preview && options.viewport
    ? framePreview(hints.preview, options.viewport, angle, dynamicTarget)
    : undefined
  const target = framing?.target ?? hints.target
  const targetZoom = options.dynamicZoom
    ? (framing?.zoom ?? dynamicTarget)
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
    x: camera.x + (target.x - camera.x) * positionFollow,
    y: camera.y + (target.y - camera.y) * positionFollow,
    angle,
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
