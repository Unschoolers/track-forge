import { normalizeSceneryTransform, type SceneryTransform } from '@/domain/track/sceneryTransform'
import type { Vector2 } from '@/domain/model'

export type TrackEnvironmentId = 'grass' | 'cityscape' | 'desert' | 'kids-room'
export const DEFAULT_TRACK_ENVIRONMENT_ID: TrackEnvironmentId = 'grass'

export const SCENERY_KINDS_BY_ENVIRONMENT = {
  grass: ['grass-shrub', 'grass-wildflowers', 'grass-boulder', 'grass-log'],
  cityscape: ['city-trash-bin', 'city-bus-stop', 'city-house', 'city-building'],
  desert: ['desert-cactus', 'desert-boulder', 'desert-rock-cluster', 'desert-rock-spire'],
  'kids-room': ['kids-blocks', 'kids-teddy', 'kids-crayons', 'kids-book', 'kids-dinosaur', 'kids-top'],
} as const satisfies Record<TrackEnvironmentId, readonly string[]>

export type SceneryPropKind = (typeof SCENERY_KINDS_BY_ENVIRONMENT)[TrackEnvironmentId][number]
export interface SceneryProp extends Vector2, SceneryTransform { readonly kind: SceneryPropKind }
export const MAX_SCENERY_PROPS = 256

export function normalizeTrackEnvironmentId(value: unknown): TrackEnvironmentId {
  return value === 'cityscape' || value === 'desert' || value === 'kids-room' ? value : DEFAULT_TRACK_ENVIRONMENT_ID
}

export function sceneryKindBelongsToEnvironment(kind: SceneryPropKind, environmentId: TrackEnvironmentId): boolean {
  return (SCENERY_KINDS_BY_ENVIRONMENT[environmentId] as readonly string[]).includes(kind)
}

export function isSceneryPosition(value: Vector2): boolean {
  return Number.isFinite(value.x) && Math.abs(value.x) <= 10_000_000 &&
    Number.isFinite(value.y) && Math.abs(value.y) <= 10_000_000
}

export function normalizeSceneryProps(value: unknown): readonly SceneryProp[] {
  if (!Array.isArray(value)) return []
  const result: SceneryProp[] = []
  for (const entry of value.slice(0, MAX_SCENERY_PROPS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const item = entry as Record<string, unknown>
    if (typeof item.kind !== 'string' || typeof item.x !== 'number' || typeof item.y !== 'number') continue
    if (!Object.values(SCENERY_KINDS_BY_ENVIRONMENT).some((kinds) => (kinds as readonly string[]).includes(item.kind as string))) continue
    const transform = normalizeSceneryTransform(item)
    if (!transform) continue
    const prop = { kind: item.kind as SceneryPropKind, x: item.x, y: item.y, ...transform }
    if (isSceneryPosition(prop)) result.push(prop)
  }
  return result
}
