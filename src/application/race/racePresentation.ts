import type { RaceState, RaceVehicle } from '@/domain/race/raceState'

function blend(from: number, to: number, fraction: number): number {
  return from + (to - from) * fraction
}

function blendAngle(from: number, to: number, fraction: number): number {
  const shortestTurn = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return from + shortestTurn * fraction
}

function mustSnap(
  before: RaceVehicle | undefined,
  vehicle: RaceVehicle,
  discontinuities: ReadonlySet<string>,
): boolean {
  return !before || discontinuities.has(vehicle.id) ||
    before.finishedAt !== vehicle.finishedAt ||
    before.structureRunId !== vehicle.structureRunId ||
    // Guard non-event teleports and stale state without inventing physics.
    Math.hypot(vehicle.x - before.x, vehicle.y - before.y) >
      Math.max(30, Math.max(Math.abs(before.speed), Math.abs(vehicle.speed)) / 24)
}

/**
 * Render-only pose interpolation. Physics, race timing, checkpoint checks and
 * network packets must continue to consume the authoritative fixed-step state.
 */
export function interpolateRaceState(
  previous: RaceState,
  current: RaceState,
  fraction: number,
  discontinuities: ReadonlySet<string>,
): RaceState {
  if (previous.phase !== 'running' || current.phase !== 'running') return current
  const alpha = Math.max(0, Math.min(1, fraction))
  if (alpha === 1) return current

  const oldVehicles = new Map(previous.vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const vehicles = current.vehicles.map((vehicle): RaceVehicle => {
    const before = oldVehicles.get(vehicle.id)
    if (mustSnap(before, vehicle, discontinuities)) return vehicle
    if (!before) return vehicle
    return {
      ...vehicle,
      x: blend(before.x, vehicle.x, alpha),
      y: blend(before.y, vehicle.y, alpha),
      z: blend(before.z, vehicle.z, alpha),
      angle: blendAngle(before.angle, vehicle.angle, alpha),
      // The car's vector silhouette depends on the suspension and landing
      // animation as well as its pose. Don't step its scale at 60 Hz.
      suspensionCompression: blend(before.suspensionCompression, vehicle.suspensionCompression, alpha),
      landingIntensity: blend(before.landingIntensity, vehicle.landingIntensity, alpha),
      verticalVelocity: blend(before.verticalVelocity, vehicle.verticalVelocity, alpha),
    }
  })

  const player = vehicles.find((vehicle) => vehicle.player)
  const playerRecovered = player !== undefined &&
    mustSnap(oldVehicles.get(player.id), player, discontinuities)
  const oldHints = previous.cameraHints
  const hints = current.cameraHints
  const oldPreview = oldHints.preview
  const preview = hints.preview
  // The look-ahead window adds and drops road points as the car moves.
  // Falling back to the newest preview when lengths differ makes framing
  // (including zoom) jump on exactly those high-speed physics ticks.
  // Duplicate the shorter window's endpoint so both ends of the transition
  // describe the same bounds and the camera remains continuous.
  const blendedPreview = !playerRecovered && oldPreview?.length && preview?.length
    ? Array.from({ length: Math.max(oldPreview.length, preview.length) }, (_, index) => {
      const before = oldPreview[Math.min(index, oldPreview.length - 1)]
      const after = preview[Math.min(index, preview.length - 1)]
      if (!before || !after) return after ?? before ?? hints.target
      return { x: blend(before.x, after.x, alpha), y: blend(before.y, after.y, alpha) }
    })
    : preview
  return {
    ...current,
    vehicles,
    cameraHints: playerRecovered ? hints : {
      ...hints,
      target: {
        x: blend(oldHints.target.x, hints.target.x, alpha),
        y: blend(oldHints.target.y, hints.target.y, alpha),
      },
      roadAngle: blendAngle(oldHints.roadAngle, hints.roadAngle, alpha),
      speed: blend(oldHints.speed, hints.speed, alpha),
      upcomingCurve: blend(oldHints.upcomingCurve, hints.upcomingCurve, alpha),
      shake: blend(oldHints.shake, hints.shake, alpha),
      ...(blendedPreview ? {
        preview: player ? [
          { x: player.x, y: player.y },
          ...blendedPreview.slice(1),
        ] : blendedPreview,
      } : {}),
    },
  }
}
