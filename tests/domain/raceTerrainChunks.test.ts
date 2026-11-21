import { expect, it } from 'vitest'
import { chunkRaceTerrain, terrainChunkVisible, terrainVisibilityWindow } from '@/phaser/rendering/raceTerrainChunks'

it('preserves terrain draw order and computes conservative chunk bounds', () => {
	const triangle = (x: number) =>
		[
			{ x, y: 0 },
			{ x: x + 1, y: 0 },
			{ x, y: 1 },
		] as const
	const primitives = [
		{
			kind: 'water' as const,
			height: 0,
			triangles: [triangle(0), triangle(100)],
			texture: [{ start: { x: 4, y: 5 }, end: { x: 6, y: 7 } }],
		},
		{
			kind: 'shoreline' as const,
			height: 0,
			rings: [
				[
					{ x: 10, y: 10 },
					{ x: 20, y: 20 },
				],
			],
		},
	]
	const chunks = chunkRaceTerrain(primitives, 1)
	expect(chunks.map((c) => c.primitive.kind)).toEqual([
		'water',
		'water',
		'water',
		'shoreline',
	])
	expect(chunks[0]?.bounds).toEqual({ left: -4, top: -4, right: 5, bottom: 5 })
	expect(chunks[1]?.bounds).toEqual({
		left: 96,
		top: -4,
		right: 105,
		bottom: 5,
	})
	expect(chunks[2]?.bounds).toEqual({ left: 0, top: 1, right: 10, bottom: 11 })
})

it('keeps chunks visible at the edge of rotated and zoomed camera bounds', async () => {
	const { groundViewportBounds } = await import(
		'@/presentation/environments/groundTexture'
	)
	const { terrainChunkVisible } = await import(
		'@/phaser/rendering/raceTerrainChunks'
	)
	for (const rotation of [0, Math.PI / 4, Math.PI / 2]) {
		for (const zoom of [0.4, 1, 2]) {
			const view = groundViewportBounds({
				centerX: 0,
				centerY: 0,
				width: 800,
				height: 400,
				rotation,
				zoom,
			})
			expect(
				terrainChunkVisible(
					{ left: view.right, right: view.right + 1, top: 0, bottom: 1 },
					view,
				),
			).toBe(true)
			expect(
				terrainChunkVisible(
					{ left: view.right + 1, right: view.right + 2, top: 0, bottom: 1 },
					view,
				),
			).toBe(false)
		}
	}
})

it('skips culling scans while a moving or rotating camera stays inside its safe window', () => {
  const visible = { left: -100, top: -100, right: 100, bottom: 100 }
  const window = terrainVisibilityWindow(visible)
  expect(window).toEqual({ left: -164, top: -164, right: 164, bottom: 164 })
  expect(terrainVisibilityWindow({ left: -150, top: -120, right: 110, bottom: 125 }, window!)).toBeNull()
  const entering = { left: 119, right: 130, top: 30, bottom: 60 }
  expect(terrainChunkVisible(entering, window!)).toBe(true)
  const shifted = { left: -90, top: -120, right: 200, bottom: 150 }
  const expanded = terrainVisibilityWindow(shifted, window!)
  expect(expanded).toEqual({ left: -154, top: -184, right: 264, bottom: 214 })
  expect(terrainChunkVisible({ left: 199, right: 208, top: 10, bottom: 20 }, expanded!)).toBe(true)
  // Invalid viewport bounds preserve the old conservative render-all behavior.
  expect(terrainChunkVisible({ left: 1000, right: 1010, top: 1000, bottom: 1010 },
    { left: Number.NaN, top: 0, right: 10, bottom: 10 })).toBe(true)
})
