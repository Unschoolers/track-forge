import { WORLD_ELEVATION } from '@/domain/config'

export interface ElevationShading {
  readonly slopeShadow: string
  readonly slopeLight: string
  readonly slopeShadowStrength: number
  readonly slopeLightStrength: number
  readonly plateauGlaze: string
}

/** A level owns the plateau and the slope leading up to that level.
 * T is a texture handle, independent of the rendering adapter. */
export interface ElevationMaterial<T> {
  readonly plateau: T
  readonly slope: T
  readonly shading: ElevationShading
}

/** Contiguous levels starting at zero. Only the first two are authored today. */
export type ElevationMaterials<T> = readonly [
  ElevationMaterial<T>, ElevationMaterial<T>, ...ElevationMaterial<T>[],
]

const BASE_SHADING: ElevationShading = {
  slopeShadow: '0,0,0',
  slopeLight: '0,0,0',
  slopeShadowStrength: 0,
  slopeLightStrength: 0,
  plateauGlaze: 'rgba(0,0,0,0)',
}

/** Explicit base and first elevated material. Adding higher entries does
 * not require any change to the material selector or tile painter. */
export function createElevationMaterials<T>(
  ground: T, raised: ElevationMaterial<T>,
): ElevationMaterials<T> {
  return [{ plateau: ground, slope: ground, shading: BASE_SHADING }, raised]
}

export function elevationMaterialForLevel<T>(
  materials: ElevationMaterials<T>, level: number,
): ElevationMaterial<T> {
  if (!Number.isSafeInteger(level) || level < 0) {
    throw new Error('Invalid terrain material level')
  }
  // Explicit visual fallback: reuse the highest authored material.
  // Never interpret the material count as permission to raise terrain.
  return materials[Math.min(level, materials.length - 1)] ?? materials[1]
}

/** Mesh primitive height is the nominal top of a terrace, not the
 * continuously sampled height partway up a slope. */
export function elevationLevelForHeight(height: number): number {
  const level = (height - WORLD_ELEVATION.baseHeight) / WORLD_ELEVATION.levelHeight
  if (!Number.isSafeInteger(level) || level < 0) {
    throw new Error('Invalid nominal terrain height for material selection')
  }
  return level
}

/** Keep actual levels distinct even when several reuse the same material. */
export function groupElevationFaces<T extends { readonly level: number }>(
  faces: readonly T[],
): readonly (readonly [number, readonly T[]])[] {
  const groups = new Map<number, T[]>()
  for (const face of faces) {
    const group = groups.get(face.level)
    if (group) group.push(face)
    else groups.set(face.level, [face])
  }
  return [...groups.entries()].sort(([a], [b]) => a - b)
}
