import { describe, expect, it } from 'vitest'
import type { RoadPath, RoadPathPoint } from '@/domain/track/pathBuilder'
import { upcomingRaceTurnCue } from '@/ui/components/raceTurnCue'

function pathFrom(
	points: readonly { readonly x: number; readonly y: number }[],
	closed = false,
): RoadPath {
	const samples: RoadPathPoint[] = points.map((point, index) => ({
		...point,
		surface: 'street',
		distance: index * 6,
		segment: index,
		sectionId: `section-${index}`,
		structure: 'surface',
	}))
	return {
		points: samples,
		totalLength: samples.length * 6,
		closed,
		crossings: [],
		terrainSurface: {
			contours: [],
			heightSampleAt: () => ({ height: 0, gradient: { x: 0, y: 0 } }),
			heightAt: () => 0,
			materialAt: () => 'grass',
			gradeAt: () => 0,
		},
		roadSurface: {
			at: () => ({
				terrainHeight: 0,
				structureHeight: 0,
				height: 0,
				grade: 0,
				material: 'grass',
				structureRunId: null,
			}),
			gradeAt: () => 0,
		},
	}
}

function rightTurn(): RoadPath {
	return pathFrom([
		{ x: 0, y: 0 },
		{ x: 6, y: 0 },
		{ x: 12, y: 0 },
		{ x: 18, y: 0 },
		{ x: 24, y: 0 },
		{ x: 30, y: 0 },
		{ x: 36, y: 0 },
		{ x: 41, y: 3 },
		{ x: 44, y: 8 },
		{ x: 44, y: 14 },
		{ x: 44, y: 20 },
		{ x: 44, y: 26 },
		{ x: 44, y: 32 },
		{ x: 44, y: 38 },
	])
}

describe('upcoming race turn cue', () => {
	it('detects a right turn in screen coordinates and reports its approach distance', () => {
		const cue = upcomingRaceTurnCue(rightTurn(), 0, false)
		expect(cue?.direction).toBe('right')
		expect(cue?.distance).toBeGreaterThan(0)
		expect(cue?.distance).toBeLessThan(60)
	})

	it('detects left turns and reverses the cue when travel direction is reversed', () => {
		const left = pathFrom(
			rightTurn().points.map((point) => ({ x: point.x, y: -point.y })),
		)
		expect(upcomingRaceTurnCue(left, 0, false)?.direction).toBe('left')
		expect(upcomingRaceTurnCue(rightTurn(), 13, true)?.direction).toBe('left')
	})

	it('finds an upcoming turn across a closed path seam', () => {
		const loop = pathFrom(
			[
				{ x: 0, y: 0 },
				{ x: 6, y: 0 },
				{ x: 12, y: 0 },
				{ x: 18, y: 0 },
				{ x: 24, y: 0 },
				{ x: 24, y: 6 },
				{ x: 24, y: 12 },
				{ x: 24, y: 18 },
				{ x: 24, y: 24 },
				{ x: 18, y: 24 },
				{ x: 12, y: 24 },
				{ x: 6, y: 24 },
				{ x: 0, y: 24 },
				{ x: 0, y: 18 },
				{ x: 0, y: 12 },
				{ x: 0, y: 6 },
			],
			true,
		)
		expect(upcomingRaceTurnCue(loop, 15, false)?.direction).toBe('right')
	})

	it('ignores straight, noisy, invalid, and too-short paths', () => {
		expect(
			upcomingRaceTurnCue(
				pathFrom(Array.from({ length: 20 }, (_, i) => ({ x: i * 6, y: 0 }))),
				0,
				false,
			),
		).toBeNull()
		const noisy = pathFrom(
			Array.from({ length: 24 }, (_, i) => ({
				x: i * 6,
				y: i % 2 ? 0.5 : -0.5,
			})),
		)
		expect(upcomingRaceTurnCue(noisy, 0, false)).toBeNull()
		expect(
			upcomingRaceTurnCue(
				pathFrom([
					{ x: 0, y: 0 },
					{ x: 6, y: 0 },
				]),
				0,
				false,
			),
		).toBeNull()
		expect(upcomingRaceTurnCue(rightTurn(), Number.NaN, false)).toBeNull()
	})

	it('bounds its scan on very long paths', () => {
		const points = Array.from({ length: 100_000 }, (_, i) => ({
			x: i * 6,
			y: 0,
		}))
		points[2_000] = { x: 12_000, y: 0 }
		const path = pathFrom(points)
		expect(upcomingRaceTurnCue(path, 0, false)).toBeNull()
	})
})
