import type { Vector2 } from '@/domain/model'
import type { TerrainPrimitive } from '@/phaser/rendering/terrainMesh'
import type { WorldBounds } from '@/presentation/environments/groundTexture'
import { MAX_SHORELINE_HALF_WIDTH } from '@/presentation/environments/shorelineMaterials'

export interface RaceTerrainChunk {
	readonly primitive: TerrainPrimitive
	readonly bounds: WorldBounds
}

export interface SpatialBatch<T> {
	readonly items: readonly T[]
	readonly bounds: WorldBounds
}

/** Keep paint order while grouping static objects for cheap viewport culling. */
export function chunkSpatialItems<T>(
	items: readonly T[],
	pointsOf: (item: T) => readonly Vector2[],
	size = 64,
	padding = 4,
): readonly SpatialBatch<T>[] {
	if (!Number.isInteger(size) || size < 1) throw new RangeError('Chunk size must be a positive integer')
	const result: SpatialBatch<T>[] = []
	for (let start = 0; start < items.length; start += size) {
		const batch = items.slice(start, start + size)
		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
		for (const item of batch) for (const point of pointsOf(item)) {
			left = Math.min(left, point.x)
			top = Math.min(top, point.y)
			right = Math.max(right, point.x)
			bottom = Math.max(bottom, point.y)
		}
		if (left !== Infinity) result.push({ items: batch, bounds: {
			left: left - padding, top: top - padding, right: right + padding, bottom: bottom + padding,
		} })
	}
	return result
}

/** Split consecutive drawing commands without changing their painter's order. */
export function chunkRaceTerrain(
	primitives: readonly TerrainPrimitive[],
	size = 128,
): readonly RaceTerrainChunk[] {
	if (!Number.isInteger(size) || size < 1)
		throw new RangeError('Chunk size must be a positive integer')
	const result: RaceTerrainChunk[] = []
	const add = (primitive: TerrainPrimitive, points: readonly Vector2[]) => {
		if (!points.length) return
		let left = Infinity,
			top = Infinity,
			right = -Infinity,
			bottom = -Infinity
		for (const p of points) {
			left = Math.min(left, p.x)
			top = Math.min(top, p.y)
			right = Math.max(right, p.x)
			bottom = Math.max(bottom, p.y)
		}
		const padding = primitive.kind === 'shoreline' ? MAX_SHORELINE_HALF_WIDTH + 2 : 4
		result.push({
			primitive,
			bounds: {
				left: left - padding,
				top: top - padding,
				right: right + padding,
				bottom: bottom + padding,
			},
		})
	}
	for (const primitive of primitives) {
		if (primitive.kind === 'shoreline') {
			// Preserve complete rings and their join behavior.
			add(primitive, primitive.rings.flat())
		} else if (primitive.kind === 'water') {
			for (let i = 0; i < primitive.triangles.length; i += size) {
				const triangles = primitive.triangles.slice(i, i + size)
				add({ ...primitive, triangles, texture: [] }, triangles.flat())
			}
			for (let i = 0; i < primitive.texture.length; i += size) {
				const texture = primitive.texture.slice(i, i + size)
				add(
					{ ...primitive, triangles: [], texture },
					texture.flatMap((line) => [line.start, line.end]),
				)
			}
		} else if (primitive.kind === 'hill-slope') {
			// The renderer paints shade buckets in ascending order.
			for (let bucket = 0; bucket < 9; bucket += 1) {
				const facets = primitive.facets.filter(
					(facet) =>
						Math.max(0, Math.min(8, Math.round((facet.shade + 1) * 4))) ===
						bucket,
				)
				for (let i = 0; i < facets.length; i += size) {
					const batch = facets.slice(i, i + size)
					add(
						{
							...primitive,
							facets: batch,
							triangles: batch.map((facet) => facet.triangle),
						},
						batch.flatMap((facet) => [...facet.triangle]),
					)
				}
			}
		} else {
			for (let i = 0; i < primitive.triangles.length; i += size) {
				const triangles = primitive.triangles.slice(i, i + size)
				add({ ...primitive, triangles }, triangles.flat())
			}
		}
	}
	return result
}

/** A safety gutter lets the camera move between visibility updates without
 * hiding incoming geometry or recreating thousands of draw commands each frame. */
export function terrainVisibilityWindow(
  viewport: WorldBounds,
  previous?: WorldBounds,
  margin = 64,
): WorldBounds | null {
  if (![viewport.left, viewport.top, viewport.right, viewport.bottom].every(Number.isFinite)) {
    return viewport
  }
  if (previous &&
      viewport.left >= previous.left && viewport.right <= previous.right &&
      viewport.top >= previous.top && viewport.bottom <= previous.bottom) {
    return null
  }
  return {
    left: viewport.left - margin,
    top: viewport.top - margin,
    right: viewport.right + margin,
    bottom: viewport.bottom + margin,
  }
}

export function terrainChunkVisible(
  bounds: WorldBounds,
  viewport: WorldBounds,
): boolean {
  // Avoid a temporary Object.values array for every chunk on every update.
  return !Number.isFinite(viewport.left) ||
    !Number.isFinite(viewport.top) ||
    !Number.isFinite(viewport.right) ||
    !Number.isFinite(viewport.bottom) ||
    (bounds.left <= viewport.right &&
      bounds.right >= viewport.left &&
      bounds.top <= viewport.bottom &&
      bounds.bottom >= viewport.top)
}
