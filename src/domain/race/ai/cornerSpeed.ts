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
): number {
  const count = path.points.length
  if (!count || path.totalLength <= 0) return 225
  const at = path.points[((nearestIndex % count) + count) % count]
  if (!at) return 225
  const direction = reversed ? -1 : 1
  let allowed = 225
  for (const step of [0, 6, 12, 20, 30, 42]) {
    const raw = nearestIndex + direction * step
    if (!path.closed && (raw < 0 || raw >= count)) break
    const index = ((raw % count) + count) % count
    const point = path.points[index]
    if (!point) continue
    const bend = Math.abs(turnAmountAt(path, index, 6))
    const apexSpeed = clamp(225 - bend * 230 * cornerSafety, 92, 225)
    let distance = direction * (point.distance - at.distance)
    if (path.closed && distance < 0) distance += path.totalLength
    distance = Math.max(0, distance)
    // Units are world units. The AI has a smooth ~95-unit/s^2 braking budget.
    const entrySpeed = Math.sqrt(apexSpeed ** 2 + 2 * 95 * distance)
    allowed = Math.min(allowed, entrySpeed)
  }
  return allowed
}
