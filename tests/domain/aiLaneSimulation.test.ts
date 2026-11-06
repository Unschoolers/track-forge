// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { requireFixture } from '../fixtures/requireFixture'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import {
	createLaneScenarios,
	decodeTrackInput,
	prepareLanePath,
} from '../../qa/lanes/scenarios'
import { runLaneCheck } from '../../qa/lanes/simulation'
import { parseLaneOptions } from '../../qa/lanes/options'

describe('AI lane simulations', () => {
	it('finishes the reverse hairpin without jumping to another arm of the route', () => {
		const track = requireFixture(createLaneScenarios().find((track) => track.id === 'hairpin'))
		const run = runLaneCheck({
			path: prepareLanePath(track), trackName: track.name, seed: 1,
			difficulty: 'normal', reversed: true, seconds: 60,
			laps: 1, mode: 'solo', car: 'blue',
		})
		expect(run.stoppedReason).toBe('finished')
		expect(run.issues.filter((issue) => issue.code === 'path-jump')).toEqual([])
	})
	it('rejects malformed or excessive geometry before the path compiler expands it', () => {
		const track = requireFixture(createLaneScenarios()[0])
		const malformed = {
			...track,
			points: [
				{ x: 0, y: 0, surface: 'street' as const },
				{ x: 1e308, y: 0, surface: 'street' as const },
			],
		}
		expect(() => prepareLanePath(malformed)).toThrow(/points/i)
		const enormous = {
			...track,
			points: track.points.map((p) => ({
				...p,
				x: p.x * 1e30,
				y: p.y * 1e30,
			})),
		}
		expect(() => prepareLanePath(enormous)).toThrow(/budget|close/i)
		const tooMany = {
			...track,
			points: Array.from({ length: 2001 }, () => ({
				x: 0,
				y: 0,
				surface: 'street' as const,
			})),
		}
		expect(() => prepareLanePath(tooMany)).toThrow(/budget/i)
	})
	it('uses real physics and produces repeatable trails, metrics and findings', () => {
		const track = requireFixture(createLaneScenarios()[0])
		const path = buildRoadPath(track.points, track.terrain)
		const options = {
			path,
			trackName: track.name,
			seed: 42,
			difficulty: 'normal' as const,
			reversed: false,
			seconds: 2,
			laps: 1,
			mode: 'traffic' as const,
			car: 'blue' as const,
		}
		const first = runLaneCheck(options)
		expect(runLaneCheck(options)).toEqual(first)
		expect(first.vehicles).toHaveLength(4)
		expect(new Set(first.samples.map((sample) => sample.vehicleId)).size).toBe(
			4,
		)
		expect(first.samples.some((sample) => sample.speed > 20)).toBe(true)
		expect(first.steps).toBe(120)
		expect(
			first.issues.filter((issue) => issue.code === 'timeout'),
		).toHaveLength(4)
		expect(first.samples.length).toBeLessThan(120 * 4)
	})
	it('runs one driver without traffic and stops as soon as it finishes', () => {
		const track = requireFixture(createLaneScenarios()[0])
		const path = buildRoadPath(track.points, track.terrain)
		const run = runLaneCheck({
			path,
			trackName: track.name,
			seed: 42,
			difficulty: 'hard',
			reversed: false,
			seconds: 90,
			laps: 1,
			mode: 'solo',
			car: 'green',
		})
		expect(run.vehicles).toHaveLength(1)
		expect(requireFixture(run.vehicles[0]).car).toBe('green')
		expect(requireFixture(run.vehicles[0]).finishedAt).not.toBeNull()
		expect(run.steps).toBeLessThan(90 * 60)
		expect(run.issues.some((issue) => issue.code === 'timeout')).toBe(false)
		expect(requireFixture(run.samples.at(-1)).time).toBeCloseTo(
			run.simulatedSeconds,
		)
	})
	it('honors relocated start lines and reverse travel', () => {
		const track = requireFixture(createLaneScenarios()[0])
		const path = buildRoadPath(track.points, track.terrain)
		const run = runLaneCheck({
			path,
			trackName: track.name,
			seed: 7,
			difficulty: 'normal',
			reversed: true,
			startRatio: 0.35,
			seconds: 1,
			laps: 1,
			mode: 'solo',
			car: 'blue',
		})
		expect(run.startRatio).toBe(0.35)
		expect(run.reversed).toBe(true)
		expect(requireFixture(run.samples[0]).pathIndex).toBeGreaterThan(
			path.points.length * 0.3,
		)
	})
	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects invalid duration %s',
		(seconds) => {
			const track = requireFixture(createLaneScenarios()[0])
			expect(() =>
				runLaneCheck({
					path: buildRoadPath(track.points, track.terrain),
					trackName: track.name,
					seed: 1,
					difficulty: 'normal',
					reversed: false,
					seconds,
					laps: 1,
					mode: 'solo',
					car: 'blue',
				}),
			).toThrow()
		},
	)
	it('rejects empty and open paths before simulation', () => {
		for (const points of [
			[],
			[
				{ x: 0, y: 0, surface: 'street' as const },
				{ x: 500, y: 0, surface: 'street' as const },
			],
		]) {
			expect(() =>
				runLaneCheck({
					path: buildRoadPath(points, EMPTY_TERRAIN),
					trackName: 'invalid',
					seed: 1,
					difficulty: 'normal',
					reversed: false,
					seconds: 1,
					laps: 1,
					mode: 'solo',
					car: 'blue',
				}),
			).toThrow(/closed/i)
		}
	})
	it('includes real mixed surfaces, tight turns and a raised crossing in fixtures', () => {
		const tracks = createLaneScenarios()
		expect(tracks.map((t) => t.id)).toEqual(['starter', 'hairpin', 'bridge'])
		expect(tracks.every((t) => buildRoadPath(t.points, t.terrain).closed)).toBe(
			true,
		)
		expect(
			buildRoadPath(
				requireFixture(tracks[2]).points,
				requireFixture(tracks[2]).terrain,
			).crossings.length,
		).toBeGreaterThan(0)
	})
	it('imports a saved track or full library with the existing track decoder', () => {
		const tracks = createLaneScenarios()
		expect(decodeTrackInput(tracks[0])).toHaveLength(1)
		expect(decodeTrackInput(tracks)).toHaveLength(3)
		expect(() =>
			decodeTrackInput({ ...tracks[0], points: [{ x: 'bad', y: 0 }] }),
		).toThrow(/invalid/i)
		expect(() => decodeTrackInput([])).toThrow()
	})
})

describe('AI lane command options', () => {
	it('defaults to a small batch with both directions and repeatable seeds', () => {
		const options = parseLaneOptions([])
		expect(options).toMatchObject({
			seeds: [1, 2, 3],
			scenarios: ['starter'],
			directions: [false, true],
			modes: ['traffic'],
			seconds: 60,
			laps: 1,
			strict: false,
		})
	})
	it('expands a stress matrix explicitly', () => {
		expect(
			parseLaneOptions([
				'--seeds',
				'2',
				'--seed',
				'9',
				'--scenario',
				'all',
				'--mode',
				'both',
				'--direction',
				'reverse',
				'--difficulty',
				'all',
				'--car',
				'all',
				'--strict',
			]),
		).toMatchObject({
			seeds: [9, 10],
			scenarios: ['starter', 'hairpin', 'bridge'],
			modes: ['solo', 'traffic'],
			directions: [true],
			difficulties: ['easy', 'normal', 'hard'],
			cars: ['blue', 'red', 'green', 'yellow'],
			strict: true,
		})
	})
	it.each([
		['--seconds', 'NaN'],
		['--seeds', '0'],
		['--laps', '1.5'],
		['--seed', '-1'],
		['--direction', 'backwards'],
		['--scenario', 'missing'],
		['--wat'],
		['--seconds'],
	])('rejects invalid options %s', (...args) => {
		expect(() => parseLaneOptions(args)).toThrow()
	})
})
