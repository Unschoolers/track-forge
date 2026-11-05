import type { RaceVehicle } from '@/domain/race/raceState'

const COLLISION_DISTANCE = 18
const COLLISION_HEIGHT = 3

export interface CollisionEvent {
  readonly leftId: string
  readonly rightId: string
  readonly strength: number
}

export interface CollisionFrame {
  readonly vehicles: readonly RaceVehicle[]
  readonly activeContacts: readonly string[]
  readonly events: readonly CollisionEvent[]
}

export function solveCollisionFrame(
  vehicles: readonly RaceVehicle[],
  previousContacts: readonly string[],
  deltaSeconds: number,
): CollisionFrame {
  const previous = new Set(previousContacts)
  const current = new Set<string>()
  const events: CollisionEvent[] = []
  const next = vehicles.map((vehicle) => ({
    ...vehicle,
    damageCooldown: Math.max(0, vehicle.damageCooldown - deltaSeconds),
  }))
  for (let leftIndex = 0; leftIndex < next.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < next.length; rightIndex += 1) {
      const left = next[leftIndex]
      const right = next[rightIndex]
      if (!left || !right || (!left.player && !right.player)) continue
      // The player can finish during this frame, before collision resolution.
      // Preserve that final-frame behavior while removing completed opponents.
      if (
        (!left.player && left.finishedAt !== null) ||
        (!right.player && right.finishedAt !== null)
      ) continue
      if (Math.abs(left.z - right.z) >= COLLISION_HEIGHT) continue
      const dx = right.x - left.x
      const dy = right.y - left.y
      const distance = Math.hypot(dx, dy)
      if (distance >= COLLISION_DISTANCE) continue
      const contact = `${left.id}:${right.id}`
      current.add(contact)
      const normalX = distance > 0 ? dx / distance : 1
      const normalY = distance > 0 ? dy / distance : 0
      const correction = (COLLISION_DISTANCE - distance) * 0.52
      const leftNormal = left.vx * normalX + left.vy * normalY
      const rightNormal = right.vx * normalX + right.vy * normalY
      const relative = Math.max(
        Math.abs(rightNormal - leftNormal),
        Math.abs(left.speed - right.speed),
      )
      const strength = Math.max(relative, (COLLISION_DISTANCE - distance) * 8)
      const impulse = (rightNormal - leftNormal) * 0.38
      let updatedLeft = {
        ...left,
        x: left.x - normalX * correction,
        y: left.y - normalY * correction,
        vx: left.vx + normalX * impulse,
        vy: left.vy + normalY * impulse,
        speed: left.speed * 0.82,
      }
      let updatedRight = {
        ...right,
        x: right.x + normalX * correction,
        y: right.y + normalY * correction,
        vx: right.vx - normalX * impulse,
        vy: right.vy - normalY * impulse,
        speed: right.speed * 0.82,
      }
      const newContact = !previous.has(contact)
      if (newContact && strength > 9) {
        updatedLeft = applyImpactDamage(updatedLeft)
        updatedRight = applyImpactDamage(updatedRight)
        events.push({ leftId: left.id, rightId: right.id, strength })
      }
      next[leftIndex] = updatedLeft
      next[rightIndex] = updatedRight
    }
  }
  return {
    vehicles: next,
    activeContacts: [...current],
    events,
  }
}

export function applyImpactDamage(vehicle: RaceVehicle): RaceVehicle {
  if (!vehicle.player || vehicle.wrecked || vehicle.damageCooldown > 0) {
    return vehicle
  }
  const damage = Math.min(vehicle.damageLimit, vehicle.damage + 1)
  const wrecked = damage >= vehicle.damageLimit
  return {
    ...vehicle,
    damage,
    damageCooldown: 0.55,
    wrecked,
    vx: wrecked ? vehicle.vx * 0.28 : vehicle.vx,
    vy: wrecked ? vehicle.vy * 0.28 : vehicle.vy,
    speed: wrecked ? vehicle.speed * 0.28 : vehicle.speed,
  }
}

export function solveCollisions(
  vehicles: readonly RaceVehicle[],
): readonly RaceVehicle[] {
  return solveCollisionFrame(vehicles, [], 0).vehicles
}
