import type { RaceCameraHints, RaceVehicle } from '@/domain/race/raceState'

/**
 * Presentation-only blending between the two most recent fixed physics steps.
 * Never feed these poses back into steering, collision, ranking or replay data.
 */
const lerp = (from: number, to: number, alpha: number): number =>
  from + (to - from) * alpha

function lerpAngle(from: number, to: number, alpha: number): number {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return from + difference * alpha
}

// A normal 60 Hz physics step is much smaller; a large jump is a respawn,
// reset or other discontinuity and must not be animated across the track.
const MAX_INTERPOLATED_STEP_DISTANCE = 48

export function interpolateRaceVehicles(
  previous: readonly RaceVehicle[],
  current: readonly RaceVehicle[],
  alpha: number,
  discontinuousIds: ReadonlySet<string>,
): readonly RaceVehicle[] {
  if (!Number.isFinite(alpha) || alpha >= 1) return current
  const blend = Math.max(0, alpha)
  return current.map((vehicle) => {
    const prior = previous.find((candidate) => candidate.id === vehicle.id)
    if (!prior || discontinuousIds.has(vehicle.id) ||
        prior.structureRunId !== vehicle.structureRunId ||
        Math.hypot(vehicle.x - prior.x, vehicle.y - prior.y) > MAX_INTERPOLATED_STEP_DISTANCE) {
      return vehicle
    }
    return {
      ...vehicle,
      x: lerp(prior.x, vehicle.x, blend),
      y: lerp(prior.y, vehicle.y, blend),
      angle: lerpAngle(prior.angle, vehicle.angle, blend),
      z: lerp(prior.z, vehicle.z, blend),
      suspensionCompression: lerp(prior.suspensionCompression, vehicle.suspensionCompression, blend),
      landingIntensity: lerp(prior.landingIntensity, vehicle.landingIntensity, blend),
    }
  })
}

/** Smooth the camera's physics-derived targets on the same timeline as cars. */
export function interpolateRaceCameraHints(
  previous: RaceCameraHints,
  current: RaceCameraHints,
  alpha: number,
  snap: boolean,
): RaceCameraHints {
  if (snap || !Number.isFinite(alpha) || alpha >= 1) return current
  const blend = Math.max(0, alpha)
  const oldPlayer = previous.preview?.[0]
  const newPlayer = current.preview?.[0]
  const preview = oldPlayer && newPlayer && current.preview
    ? [
      { x: lerp(oldPlayer.x, newPlayer.x, blend),
        y: lerp(oldPlayer.y, newPlayer.y, blend) },
      ...current.preview.slice(1),
    ]
    : current.preview
  return {
    ...current,
    target: {
      x: lerp(previous.target.x, current.target.x, blend),
      y: lerp(previous.target.y, current.target.y, blend),
    },
    roadAngle: lerpAngle(previous.roadAngle, current.roadAngle, blend),
    upcomingCurve: lerp(previous.upcomingCurve, current.upcomingCurve, blend),
    speed: lerp(previous.speed, current.speed, blend),
    shake: lerp(previous.shake, current.shake, blend),
    ...(preview ? { preview } : {}),
  }
}
