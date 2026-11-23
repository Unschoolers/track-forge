import { ROAD_GEOMETRY } from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type { CarId, DifficultyId, Vector2 } from '@/domain/model'
import { turnAmountAt } from '@/domain/race/trackContext'
import type { RoadPath } from '@/domain/track/pathBuilder'

/**
 * Returns a target-world-space displacement toward the *inside* of a bend.
 *
 * A racing shortcut may briefly leave the road, just like a human driver.
 * We never reclassify that position as paved: vehiclePhysics keeps its normal
 * off-road grip, drag, and speed penalties. The road recovery/checkpoint code
 * also remains unchanged.
 */
export function plannedApexCut(
  path: RoadPath,
  targetIndex: number,
  reversed: boolean,
  difficulty: DifficultyId,
  car: CarId,
  currentRoadOffset: number,
  currentLateralVelocity: number,
): Vector2 {
  const none = { x: 0, y: 0 }
  if (difficulty === 'easy' || path.points.length < 8) return none
  const count = path.points.length
  if (!path.closed && (targetIndex < 4 || targetIndex >= count - 4)) return none
  const point = path.points[targetIndex]
  if (!point || point.structure !== 'surface' || point.surface === 'ice') return none

  // The inside must be established at the prospective apex, not inferred
  // from the car's current normal, which can face another way in a hairpin.
  const direction = reversed ? -1 : 1
  const signedBend = turnAmountAt(path, targetIndex, 6) * direction
  const bend = Math.abs(signedBend)
  if (bend < 0.055) return none

  // A chicane calls for centering and rotating for the second turn. Cutting
  // the first apex while the road reverses leads directly off the next arm.
  const before = turnAmountAt(path, targetIndex - direction * 12, 6) * direction
  const after = turnAmountAt(path, targetIndex + direction * 12, 6) * direction
  if ((before * signedBend < 0 && Math.abs(before) > 0.055) ||
      (after * signedBend < 0 && Math.abs(after) > 0.055)) return none

  // Favor cars built for grass/dirt rather than overriding chassis identity.
  const capability = car === 'red' ? 0.55 : car === 'blue' ? 0.9 : 1
  const cornerStrength = clamp((bend - 0.055) / 0.18, 0, 1)
  const width = ROAD_GEOMETRY.onRoadRadius
  // At the center of the apex this targets up to 8-12 units of shoulder
  // beyond the on-road radius, well inside the ordinary AI recovery distance.
  const maximumCut = width + (difficulty === 'hard' ? 12 : 8)
  const offset = maximumCut * cornerStrength * capability
  if (offset < 7) return none

  // Don't command an already-wide car farther outward. Actual lateral
  // velocity, not visual chassis orientation, determines this safety guard.
  const outward = Math.max(0, Math.sign(currentRoadOffset) * currentLateralVelocity)
  const edge = Math.abs(currentRoadOffset) + outward * 0.18
  const reserve = clamp((width + 10 - edge) / 27, 0, 1)
  if (reserve < 0.05) return none

  const at = (raw: number) => path.points[
    path.closed ? ((raw % count) + count) % count : clamp(raw, 0, count - 1)
  ]
  const previous = at(targetIndex - 3)
  const next = at(targetIndex + 3)
  if (!previous || !next) return none
  const dx = next.x - previous.x
  const dy = next.y - previous.y
  const length = Math.hypot(dx, dy)
  if (length < 0.01) return none
  // Road normal is authored-forward. A positive authored turn means
  // inside lies left of its tangent, even if racing the route in reverse.
  const sign = Math.sign(signedBend) * direction
  const cut = offset * reserve * sign
  const destination = { x: point.x - dy / length * cut, y: point.y + dx / length * cut }

  // Never plan a shortcut through water, bridge supports or crossing decks.
  // Physical offroad is fine; changing support levels is not.
  if (path.terrainSurface.materialAt(destination) === 'water') return none
  if (path.crossings.some(crossing =>
    Math.hypot(destination.x - crossing.position.x, destination.y - crossing.position.y) <
      crossing.bridgeHalfLength + width + 20
  )) return none
  const roadHeight = path.roadSurface.at(targetIndex).height
  if (Math.abs(path.terrainSurface.heightAt(destination) - roadHeight) > 10) return none

  return { x: destination.x - point.x, y: destination.y - point.y }
}
