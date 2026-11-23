import type { RaceState, RaceVehicle } from '@/domain/race/raceState'

function blend(from: number, to: number, fraction: number): number {
  return from + (to - from) * fraction
}

function blendAngle(from: number, to: number, fraction: number): number {
  const shortestTurn = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return from + shortestTurn * fraction
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
    if (!before || discontinuities.has(vehicle.id) ||
      before.finishedAt !== vehicle.finishedAt ||
      // Guard non-event teleports and stale state without inventing physics.
      Math.hypot(vehicle.x - before.x, vehicle.y - before.y) >
        Math.max(30, Math.max(Math.abs(before.speed), Math.abs(vehicle.speed)) / 24)
    ) return vehicle
    return {
      ...vehicle,
      x: blend(before.x, vehicle.x, alpha),
      y: blend(before.y, vehicle.y, alpha),
      z: blend(before.z, vehicle.z, alpha),
      angle: blendAngle(before.angle, vehicle.angle, alpha),
    }
  })

  const player = vehicles.find((vehicle) => vehicle.player)
  const playerRecovered = player !== undefined && discontinuities.has(player.id)
  const oldHints = previous.cameraHints
  const hints = current.cameraHints
  const oldPreview = oldHints.preview
  const preview = hints.preview
  // Preview points feed the camera's high-speed framing. Interpolating them
  // together with the car prevents the camera from stepping at 60 Hz.
  const blendedPreview = !playerRecovered && oldPreview && preview &&
    oldPreview.length === preview.length
    ? preview.map((point, index) => {
      const before = oldPreview[index]
      return before
        ? { x: blend(before.x, point.x, alpha), y: blend(before.y, point.y, alpha) }
        : point
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
      ...(blendedPreview ? {
        preview: player ? [
          { x: player.x, y: player.y },
          ...blendedPreview.slice(1),
        ] : blendedPreview,
      } : {}),
    },
  }
}
