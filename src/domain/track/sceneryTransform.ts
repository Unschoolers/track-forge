/** Authored, renderer-independent scenery transforms. Missing values are legacy defaults. */
export interface SceneryTransform {
  readonly rotation?: number
  readonly scale?: number
}

export const TREE_SIZE = 56
export const MIN_SCENERY_SCALE = 0.25
export const MAX_SCENERY_SCALE = 2
export const SCENERY_SCALE_STEP = 0.05

export function normalizeSceneryTransform(item: { readonly rotation?: unknown; readonly scale?: unknown }): SceneryTransform | undefined {
  const { rotation, scale } = item
  if (rotation !== undefined && (typeof rotation !== 'number' || !Number.isFinite(rotation) || rotation < 0 || rotation > 360)) return undefined
  if (scale !== undefined && (typeof scale !== 'number' || !Number.isFinite(scale) || scale < MIN_SCENERY_SCALE || scale > MAX_SCENERY_SCALE)) return undefined
  return {
    ...(rotation && rotation !== 360 ? { rotation } : {}),
    ...(scale !== undefined && scale !== 1 ? { scale } : {}),
  }
}

export function sceneryScale(item: SceneryTransform): number {
  return item.scale ?? 1
}

export function sceneryRotation(item: SceneryTransform): number {
  return (item.rotation ?? 0) * Math.PI / 180
}

export function stepSceneryScale(scale: number, direction: -1 | 1): number {
  return Math.max(MIN_SCENERY_SCALE, Math.min(MAX_SCENERY_SCALE, Math.round((scale + direction * SCENERY_SCALE_STEP) * 100) / 100))
}

export type ScenerySelection = { readonly type: 'tree' | 'prop'; readonly index: number }
