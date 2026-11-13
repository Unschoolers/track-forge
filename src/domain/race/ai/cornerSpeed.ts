import { CAR_SPECS, SURFACE_SPECS, VEHICLE_TERRAIN_SPECS } from '@/domain/config'
import type { CarId } from '@/domain/model'
import { clamp } from '@/domain/geometry/math'
import { turnAmountAt } from '@/domain/race/trackContext'
import type { RoadPath } from '@/domain/track/pathBuilder'

/**
 * Predict a safe entry speed through the next bends. For every sampled apex,
 * allow only the speed that could still brake down to its corner speed.
 * Distances are actual path arc-lengths, including reverse/wrap races.
 */
export function safeEntrySpeedAhead(
  path: RoadPath,
  nearestIndex: number,
  reversed: boolean,
  cornerSafety: number,
  car: Pick<(typeof CAR_SPECS)[CarId], "max" | "grip" | "brake"> = CAR_SPECS.blue,
  pace = 1,
  carId: CarId = 'blue',
): number {
  const count = path.points.length
  if (!count || path.totalLength <= 0) return 225
  const at = path.points[((nearestIndex % count) + count) % count]
  if (!at) return 225
  const direction = reversed ? -1 : 1
  const straightSpeed = car.max * pace
  let allowed = straightSpeed
  for (const step of [0, 6, 12, 20, 30, 42]) {
    const raw = nearestIndex + direction * step
    if (!path.closed && (raw < 0 || raw >= count)) break
    const index = ((raw % count) + count) % count
    const point = path.points[index]
    if (!point) continue
    const bend = Math.abs(turnAmountAt(path, index, 6))
    const surface = SURFACE_SPECS[point.surface]
    const terrain = VEHICLE_TERRAIN_SPECS[carId][point.surface]
    const grip = Math.sqrt(car.grip * surface.grip * terrain.grip)
    const surfaceMax = straightSpeed * surface.max * terrain.max
    // Allow the chassis more time to rotate through tight bends, especially
    // when traffic places it away from the center of the racing line.
    const apexSpeed = Math.min(surfaceMax, clamp(
      (225 - bend * 350 * cornerSafety) * grip +
        Math.max(0, straightSpeed - 225) * Math.exp(-bend * 20),
      70, straightSpeed,
    ))
    let distance = direction * (point.distance - at.distance)
    if (path.closed && distance < 0) distance += path.totalLength
    distance = Math.max(0, distance)
    // Units are world units. The AI has a smooth ~95-unit/s^2 braking budget.
    const entrySpeed = Math.sqrt(apexSpeed ** 2 + 2 * 95 * car.brake * surface.brake * terrain.brake * distance)
    allowed = Math.min(allowed, entrySpeed)
  }
  return allowed
}
