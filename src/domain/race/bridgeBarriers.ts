import {
  ROAD_GEOMETRY,
  VERTICAL_DYNAMICS,
  WORLD_ELEVATION,
} from '@/domain/config'
import { applyImpactDamage } from '@/domain/race/collisions'
import type { RaceVehicle } from '@/domain/race/raceState'
import type { RoadPath } from '@/domain/track/pathBuilder'

export interface BridgeBarrierEvent {
  readonly vehicleId: string
  readonly structureRunId: string
  readonly strength: number
}

export interface BridgeBarrierFrame {
  readonly vehicles: readonly RaceVehicle[]
  readonly activeContacts: readonly string[]
  readonly events: readonly BridgeBarrierEvent[]
}

function pathPoint(path: RoadPath, index: number) {
  const count = path.points.length
  if (count === 0) return undefined
  const normalized = path.closed
    ? (index + count) % count
    : Math.max(0, Math.min(count - 1, index))
  return path.points[normalized]
}

export function solveBridgeBarrierFrame(
  previousVehicles: readonly RaceVehicle[],
  movedVehicles: readonly RaceVehicle[],
  path: RoadPath,
  previousContacts: readonly string[],
): BridgeBarrierFrame {
  const previousContactSet = new Set(previousContacts)
  const activeContacts = new Set<string>()
  const events: BridgeBarrierEvent[] = []
  const vehicles = movedVehicles.map((moved, vehicleIndex) => {
    const previous = previousVehicles[vehicleIndex]
    const center = pathPoint(path, moved.pathIndex)
    const before = pathPoint(path, moved.pathIndex - 2)
    const after = pathPoint(path, moved.pathIndex + 2)
    if (!previous || !center || !before || !after) return moved

    const roadSurface = path.roadSurface.at(
      previous.pathIndex,
      previous,
    )
    if (
      roadSurface.structureHeight <
        ROAD_GEOMETRY.bridgeWallClearance * WORLD_ELEVATION.levelHeight ||
      !roadSurface.structureRunId
    ) {
      return moved
    }
    const wallTop =
      roadSurface.height + VERTICAL_DYNAMICS.bridgeWallHeight
    if (!previous.grounded && previous.z > wallTop) {
      return moved
    }
    const tangentLength = Math.max(
      0.001,
      Math.hypot(after.x - before.x, after.y - before.y),
    )
    const tangent = {
      x: (after.x - before.x) / tangentLength,
      y: (after.y - before.y) / tangentLength,
    }
    const normal = { x: -tangent.y, y: tangent.x }
    const offset = {
      x: moved.x - center.x,
      y: moved.y - center.y,
    }
    const lateral = offset.x * normal.x + offset.y * normal.y
    const vehicleHalfWidth = 7
    const lateralLimit =
      ROAD_GEOMETRY.surfaceWidth / 2 - vehicleHalfWidth
    if (Math.abs(lateral) <= lateralLimit) return moved

    const side = Math.sign(lateral) || 1
    const overflow = Math.abs(lateral) - lateralLimit
    const lateralVelocity = moved.vx * normal.x + moved.vy * normal.y
    const outwardVelocity = Math.max(0, lateralVelocity * side)
    const reflectedLateral = -outwardVelocity * 0.42 * side
    const forwardVelocity =
      moved.vx * tangent.x + moved.vy * tangent.y
    const strength = Math.max(outwardVelocity, overflow * 11)
    const contact =
      `barrier:${moved.id}:${roadSurface.structureRunId}:${side}`
    activeContacts.add(contact)
    let resolved: RaceVehicle = {
      ...moved,
      x:
        center.x +
        tangent.x * (offset.x * tangent.x + offset.y * tangent.y) +
        normal.x * lateralLimit * side,
      y:
        center.y +
        tangent.y * (offset.x * tangent.x + offset.y * tangent.y) +
        normal.y * lateralLimit * side,
      vx:
        tangent.x * forwardVelocity * 0.76 +
        normal.x * reflectedLateral,
      vy:
        tangent.y * forwardVelocity * 0.76 +
        normal.y * reflectedLateral,
      speed: Math.hypot(
        forwardVelocity * 0.76,
        reflectedLateral,
      ),
    }
    if (!previousContactSet.has(contact) && strength > 9) {
      resolved = applyImpactDamage(resolved)
      events.push({
        vehicleId: resolved.id,
        structureRunId: roadSurface.structureRunId,
        strength,
      })
    }
    return resolved
  })
  return {
    vehicles,
    activeContacts: [...activeContacts],
    events,
  }
}
