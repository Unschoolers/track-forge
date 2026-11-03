import type { Vector2 } from '@/domain/model'
import { WORLD_ELEVATION } from '@/domain/config'
import type {
  TerrainMaterial,
  TerrainSurface,
} from '@/domain/terrain/terrainSurface'

export const WORLD_LIGHTING = {
  /** Southeast cast direction from a low, northwestern 9 a.m. sun. */
  sunShadowDirection: { x: 0.783, y: 0.622 },
  shadowLengthPerHeight: 1.55,
  penumbraScale: 1.22,
} as const

export function projectSunShadow(
  point: Vector2,
  height: number,
  scale = 1,
): Vector2 {
  const projection =
    Math.max(0, Number.isFinite(height) ? height : 0) *
    WORLD_LIGHTING.shadowLengthPerHeight *
    Math.max(0, Number.isFinite(scale) ? scale : 1)
  return {
    x: point.x + WORLD_LIGHTING.sunShadowDirection.x * projection,
    y: point.y + WORLD_LIGHTING.sunShadowDirection.y * projection,
  }
}

export interface TerrainShadowProjection {
  readonly point: Vector2
  readonly terrainHeight: number
  readonly material: TerrainMaterial
  readonly clearance: number
}

/**
 * Intersects the descending sun ray with compiled terrain. A bounded march
 * finds the first receiving bracket, then deterministic bisection converges
 * across both increasing and decreasing terrain transitions.
 */
export function projectSunShadowOntoTerrain(
  point: Vector2,
  absoluteHeight: number,
  terrain: TerrainSurface,
  scale = 1,
): TerrainShadowProjection {
  const height = Number.isFinite(absoluteHeight)
    ? Math.max(WORLD_ELEVATION.baseHeight, absoluteHeight)
    : WORLD_ELEVATION.baseHeight
  const maximumClearance = height - WORLD_ELEVATION.baseHeight
  const at = (clearance: number): {
    readonly point: Vector2
    readonly terrainHeight: number
    readonly gap: number
  } => {
    const projected = projectSunShadow(point, clearance, scale)
    const terrainHeight = terrain.heightAt(projected)
    return {
      point: projected,
      terrainHeight,
      gap: height - clearance - terrainHeight,
    }
  }
  const source = at(0)
  if (source.gap <= 0 || maximumClearance <= 0) {
    return {
      point: source.point,
      terrainHeight: source.terrainHeight,
      material: terrain.materialAt(source.point),
      clearance: 0,
    }
  }

  const marchSteps = 32
  let lower = 0
  let upper = maximumClearance
  let bracketed = false
  for (let step = 1; step <= marchSteps; step += 1) {
    const candidate = (maximumClearance * step) / marchSteps
    if (at(candidate).gap <= 0) {
      upper = candidate
      bracketed = true
      break
    }
    lower = candidate
  }
  if (!bracketed) upper = maximumClearance

  const bisectionSteps = 24
  for (let step = 0; step < bisectionSteps; step += 1) {
    const middle = (lower + upper) / 2
    if (at(middle).gap > 0) lower = middle
    else upper = middle
  }
  const clearance = (lower + upper) / 2
  const receiver = at(clearance)
  return {
    point: receiver.point,
    terrainHeight: receiver.terrainHeight,
    material: terrain.materialAt(receiver.point),
    clearance,
  }
}
