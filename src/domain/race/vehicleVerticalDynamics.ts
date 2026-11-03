export interface VehicleVerticalState {
  readonly z: number
  readonly verticalVelocity: number
  readonly grounded: boolean
  readonly suspensionCompression: number
  readonly landingIntensity: number
}

export interface VehicleVerticalEnvironment {
  readonly previousSurfaceHeight: number
  readonly surfaceHeight: number
  readonly previousGrade: number
  readonly grade: number
  readonly longitudinalSpeed: number
  readonly previousOverRoad: boolean
  readonly overRoad: boolean
}

export interface VehicleVerticalResult extends VehicleVerticalState {
  readonly contactLoad: number
}

export const SUPPORT_HEIGHT_EPSILON = 0.01

export function stepVehicleVerticalDynamics(
  state: VehicleVerticalState,
  environment: VehicleVerticalEnvironment,
  deltaSeconds: number,
): VehicleVerticalResult {
  const dt = clamp(
    finiteOr(deltaSeconds),
    0,
    VERTICAL_DYNAMICS.maximumDeltaSeconds,
  )
  const previousSurfaceHeight = Math.max(
    0,
    finiteOr(environment.previousSurfaceHeight),
  )
  const surfaceHeight = Math.max(0, finiteOr(environment.surfaceHeight))
  const previousGrade = clamp(
    finiteOr(environment.previousGrade),
    -VERTICAL_DYNAMICS.maximumGrade,
    VERTICAL_DYNAMICS.maximumGrade,
  )
  const grade = clamp(
    finiteOr(environment.grade),
    -VERTICAL_DYNAMICS.maximumGrade,
    VERTICAL_DYNAMICS.maximumGrade,
  )
  const speed = Math.max(0, finiteOr(environment.longitudinalSpeed))
  const z = Math.max(
    0,
    finiteOr(state.z, state.grounded ? previousSurfaceHeight : surfaceHeight),
  )
  const verticalVelocity = finiteOr(state.verticalVelocity)
  const landingIntensity = clamp(
    finiteOr(state.landingIntensity) *
      Math.exp(-VERTICAL_DYNAMICS.landingDecay * dt),
    0,
    1,
  )

  if (!state.grounded) {
    const nextVerticalVelocity =
      verticalVelocity - VERTICAL_DYNAMICS.gravity * dt
    const nextZ =
      z +
      verticalVelocity * dt -
      0.5 * VERTICAL_DYNAMICS.gravity * dt * dt
    if (nextVerticalVelocity <= 0 && nextZ <= surfaceHeight) {
      const impact = clamp(
        -nextVerticalVelocity * VERTICAL_DYNAMICS.landingVelocityScale,
        0,
        1,
      )
      return {
        z: surfaceHeight,
        verticalVelocity: 0,
        grounded: true,
        suspensionCompression: impact,
        landingIntensity: impact,
        contactLoad: clamp(
          1 + impact * VERTICAL_DYNAMICS.landingContactScale,
          VERTICAL_DYNAMICS.minimumContactLoad,
          VERTICAL_DYNAMICS.maximumContactLoad,
        ),
      }
    }
    return {
      z: Math.max(surfaceHeight, nextZ),
      verticalVelocity: nextVerticalVelocity,
      grounded: false,
      suspensionCompression: 0,
      landingIntensity,
      contactLoad: 0,
    }
  }

  const lostRaisedRoadSupport =
    environment.previousOverRoad &&
    !environment.overRoad &&
    previousSurfaceHeight > surfaceHeight + SUPPORT_HEIGHT_EPSILON &&
    z > surfaceHeight + SUPPORT_HEIGHT_EPSILON
  if (lostRaisedRoadSupport) {
    return {
      z,
      verticalVelocity,
      grounded: false,
      suspensionCompression: 0,
      landingIntensity,
      contactLoad: 0,
    }
  }

  const surfaceVelocity =
    dt > 0 ? (surfaceHeight - previousSurfaceHeight) / dt : 0
  const crestDrop = Math.max(0, previousGrade - grade)
  const crestStrength = clamp(
    crestDrop / VERTICAL_DYNAMICS.crestDropForFullLaunch,
    0,
    1,
  )
  const carriedVelocity = Math.max(
    verticalVelocity,
    speed * Math.sin(previousGrade),
  )
  const launchVelocity = Math.min(
    VERTICAL_DYNAMICS.maximumLaunchVelocity,
    carriedVelocity * crestStrength,
  )
  if (
    environment.overRoad &&
    launchVelocity >= VERTICAL_DYNAMICS.takeoffVelocityThreshold
  ) {
    return {
      z: Math.max(surfaceHeight, z + launchVelocity * dt),
      verticalVelocity: launchVelocity,
      grounded: false,
      suspensionCompression: Math.min(
        0,
        finiteOr(state.suspensionCompression),
      ),
      landingIntensity,
      contactLoad: 0,
    }
  }

  const compressionTarget = clamp(
    (surfaceVelocity - verticalVelocity) *
      (VERTICAL_DYNAMICS.suspensionTravel /
        VERTICAL_DYNAMICS.suspensionGradeScale),
    -1,
    1,
  )
  const response =
    1 - Math.exp(-VERTICAL_DYNAMICS.suspensionResponse * dt)
  const suspensionCompression =
    clamp(
      finiteOr(state.suspensionCompression) +
        (compressionTarget - finiteOr(state.suspensionCompression)) *
          response,
      -1,
      1,
    )
  return {
    z: surfaceHeight,
    verticalVelocity: surfaceVelocity,
    grounded: true,
    suspensionCompression,
    landingIntensity,
    contactLoad: clamp(
      1 +
        suspensionCompression *
          VERTICAL_DYNAMICS.suspensionContactScale,
      VERTICAL_DYNAMICS.minimumContactLoad,
      VERTICAL_DYNAMICS.maximumContactLoad,
    ),
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function finiteOr(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}
import { VERTICAL_DYNAMICS } from '@/domain/config'
