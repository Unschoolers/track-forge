import type { Vector2 } from '@/domain/model'
import type { TerrainPrimitive } from '@/phaser/rendering/terrainMesh'
import type { WorldBounds } from '@/presentation/environments/groundTexture'

export interface RaceTerrainChunk {
	readonly primitive: TerrainPrimitive
	readonly bounds: WorldBounds
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
		result.push({
			primitive,
			bounds: {
				left: left - 4,
				top: top - 4,
				right: right + 4,
				bottom: bottom + 4,
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

export function terrainChunkVisible(
	bounds: WorldBounds,
	viewport: WorldBounds,
): boolean {
	return (
		!Object.values(viewport).every(Number.isFinite) ||
		(bounds.left <= viewport.right &&
			bounds.right >= viewport.left &&
			bounds.top <= viewport.bottom &&
			bounds.bottom >= viewport.top)
	)
}
