import { clamp } from '@/domain/geometry/math'
import type { Track, Vector2 } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'
import type { TerrainSurface } from '@/domain/terrain/terrainSurface'
import { normalizeTrackEnvironmentId, sceneryKindBelongsToEnvironment, type SceneryPropKind } from '@/domain/track/trackEnvironment'

const CELL_SIZE = 64
const CAR_RADIUS = 6
const PROP_RADIUS: Record<SceneryPropKind, number> = {
  'grass-shrub': 12,
  'grass-wildflowers': 4,
  'grass-boulder': 20,
  'grass-log': 18,
  'city-trash-bin': 10,
  'city-bus-stop': 15,
  'city-house': 26,
  'city-building': 36,
  'desert-cactus': 9,
  'desert-boulder': 22,
  'desert-rock-cluster': 22,
  'desert-rock-spire': 17,
}

interface SceneryCollider extends Vector2 {
  readonly contactRadius: number
  readonly groundHeight: number
}

export type RecoveryScenery = Pick<Track, 'trees' | 'scenery' | 'environmentId'>
export type SceneryColliders = ReadonlyMap<string, readonly SceneryCollider[]>

export function buildSceneryColliders(scenery: RecoveryScenery, terrain: TerrainSurface): SceneryColliders {
  const cells = new Map<string, SceneryCollider[]>()
  const add = (position: Vector2, radius: number): void => {
    const contactRadius = radius + CAR_RADIUS
    const collider = { x: position.x, y: position.y, contactRadius, groundHeight: terrain.heightAt(position) }
    for (let column = Math.floor((collider.x - contactRadius) / CELL_SIZE);
      column <= Math.floor((collider.x + contactRadius) / CELL_SIZE); column++) {
      for (let row = Math.floor((collider.y - contactRadius) / CELL_SIZE);
        row <= Math.floor((collider.y + contactRadius) / CELL_SIZE); row++) {
        const key = `${column}:${row}`
        const cell = cells.get(key)
        if (cell) cell.push(collider)
        else cells.set(key, [collider])
      }
    }
  }
  for (const tree of scenery.trees) add(tree, 8)
  const environment = normalizeTrackEnvironmentId(scenery.environmentId)
  for (const prop of scenery.scenery ?? []) {
    if (sceneryKindBelongsToEnvironment(prop.kind, environment)) add(prop, PROP_RADIUS[prop.kind])
  }
  return cells
}

export function hitScenery(
  colliders: SceneryColliders,
  before: Pick<RaceVehicle, 'x' | 'y' | 'z'>,
  after: Pick<RaceVehicle, 'x' | 'y' | 'z'>,
): boolean {
  const dx = after.x - before.x
  const dy = after.y - before.y
  const movementSquared = dx * dx + dy * dy
  if (movementSquared <= 0.0001 || movementSquared > (2 * CELL_SIZE) ** 2) return false
  for (let column = Math.floor(Math.min(before.x, after.x) / CELL_SIZE);
    column <= Math.floor(Math.max(before.x, after.x) / CELL_SIZE); column++) {
    for (let row = Math.floor(Math.min(before.y, after.y) / CELL_SIZE);
      row <= Math.floor(Math.max(before.y, after.y) / CELL_SIZE); row++) {
      for (const collider of colliders.get(`${column}:${row}`) ?? []) {
        const fromX = collider.x - before.x
        const fromY = collider.y - before.y
        const heightLimit = collider.groundHeight + 18
        const radiusSquared = collider.contactRadius ** 2
        // Give cars placed inside a collider room to leave after recovery.
        if (before.z <= heightLimit && fromX * fromX + fromY * fromY <= radiusSquared) continue
        const t = clamp((fromX * dx + fromY * dy) / movementSquared, 0, 1)
        if (before.z + (after.z - before.z) * t <= heightLimit &&
          (fromX - dx * t) ** 2 + (fromY - dy * t) ** 2 <= radiusSquared) return true
      }
    }
  }
  return false
}
