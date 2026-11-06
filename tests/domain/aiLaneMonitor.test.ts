// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { requireFixture } from '../fixtures/requireFixture'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { LaneMonitor } from '../../qa/lanes/monitor'

const track = createStarterTrack(asTrackId('lane-monitor'), 1)
const path = buildRoadPath(track.points, track.terrain)
function fixture(reversed = false): RaceState {
	const race = createRace({
		path,
		playerCar: 'blue',
		difficulty: 'normal',
		laps: 1,
		reversed,
	})
	return {
		...race,
		phase: 'running',
		vehicles: race.vehicles.filter((v) => !v.player).slice(0, 1),
	}
}
function placed(race: RaceState, lane: number): RaceVehicle {
	const vehicle = requireFixture(race.vehicles[0])
	const index = 50
	const p = requireFixture(path.points[index])
	const before = requireFixture(path.points[index - 3])
	const after = requireFixture(path.points[index + 3])
	const length = Math.hypot(after.x - before.x, after.y - before.y)
	return {
		...vehicle,
		pathIndex: index,
		x: p.x - ((after.y - before.y) / length) * lane,
		y: p.y + ((after.x - before.x) / length) * lane,
		lane,
		ai: { ...requireFixture(vehicle.ai), targetLane: 0 },
	}
}
function observeFor(
	monitor: LaneMonitor,
	race: RaceState,
	vehicle: RaceVehicle,
	seconds: number,
) {
	let previous = race
	for (let index = 1; index <= Math.round(seconds * 60); index++) {
		const state = {
			...race,
			elapsed: race.elapsed + index / 60,
			vehicles: [vehicle],
		}
		monitor.observe(previous, { state, events: [] }, 1 / 60)
		previous = state
	}
}

describe('AI lane monitor', () => {
	it('inspects a finishing frame for an implausible path jump', () => {
		const race = fixture()
		const point = requireFixture(path.points[2])
		const before: RaceState = {
			...race,
			elapsed: 1,
			vehicles: [
				{
					...requireFixture(race.vehicles[0]),
					x: point.x,
					y: point.y,
					pathIndex: path.points.length - 20,
					nextSector: 4,
				},
			],
		}
		// Feed the faulty finishing frame directly: the engine must now prevent
		// this route jump, while the monitor must still detect it if it occurs.
		const result = {
			state: { ...before, elapsed: 1 + 1 / 60, vehicles: [{
				...requireFixture(before.vehicles[0]), pathIndex: 2, finishedAt: 1 + 1 / 60,
			}] },
			events: [],
		}
		const monitor = new LaneMonitor(before)
		monitor.observe(before, result, 1 / 60)
		expect(monitor.issues.some((issue) => issue.code === 'path-jump')).toBe(
			true,
		)
	})

	it('ignores production recovery events from cars that finished before the step', () => {
		const race = fixture()
		const before = {
			...race,
			elapsed: 1,
			vehicles: [
				{
					...requireFixture(race.vehicles[0]),
					x: 4000,
					y: 4000,
					finishedAt: 0.5,
				},
			],
		}
		const result = stepRace(
			before,
			{ steering: 0, throttle: 0, braking: false },
			1 / 60,
			{ next: () => 0.5 },
		)
		expect(
			result.events.some((event) => event.type === 'vehicle-recovered'),
		).toBe(true)
		const monitor = new LaneMonitor(before)
		monitor.observe(before, result, 1 / 60)
		expect(monitor.issues).toHaveLength(0)
		expect(requireFixture(monitor.metrics()[0]).recoveries).toBe(0)
	})
	it('flags an implausible route jump with its destination section', () => {
		const race = fixture()
		const point = requireFixture(path.points[80])
		const beforePoint = requireFixture(path.points[10])
		const previous = {
			...race,
			vehicles: [
				{
					...requireFixture(race.vehicles[0]),
					x: beforePoint.x,
					y: beforePoint.y,
					pathIndex: 10,
				},
			],
		}
		const monitor = new LaneMonitor(previous)
		monitor.observe(
			previous,
			{
				state: {
					...race,
					elapsed: 1 / 60,
					vehicles: [
						{
							...requireFixture(race.vehicles[0]),
							x: point.x,
							y: point.y,
							pathIndex: 80,
						},
					],
				},
				events: [],
			},
			1 / 60,
		)
		expect(monitor.issues).toContainEqual(
			expect.objectContaining({
				code: 'path-jump',
				severity: 'error',
				sectionId: point.sectionId,
			}),
		)
	})
	it('ignores brief departures, then emits one finding for a sustained episode', () => {
		const race = fixture()
		const monitor = new LaneMonitor(race)
		const outside = placed(race, 55)
		observeFor(monitor, race, outside, 0.1)
		expect(monitor.issues.filter((i) => i.code === 'off-road')).toHaveLength(0)
		observeFor(monitor, { ...race, elapsed: 0.1 }, outside, 1)
		expect(monitor.issues.filter((i) => i.code === 'off-road')).toHaveLength(1)
		expect(monitor.issues.find((i) => i.code === 'off-road')).toMatchObject({
			vehicleId: outside.id,
			severity: 'warning',
			sectionId: expect.any(String),
			x: outside.x,
			y: outside.y,
		})
	})
	it('allows a legitimate passing lane and detects a sustained failure to follow it', () => {
		const race = fixture()
		const vehicle = placed(race, 24)
		const passing = {
			...vehicle,
			ai: {
				...requireFixture(vehicle.ai),
				targetLane: 24,
				phase: 'passing' as const,
			},
		}
		const okay = new LaneMonitor(race)
		observeFor(okay, race, passing, 2)
		expect(okay.issues.some((i) => i.code === 'lane-deviation')).toBe(false)
		const missed = new LaneMonitor(race)
		observeFor(missed, race, vehicle, 2)
		expect(
			missed.issues.filter((i) => i.code === 'lane-deviation'),
		).toHaveLength(1)
	})
	it.each([false, true])(
		'uses travel direction for wrong-way checks (reversed=%s)',
		(reversed) => {
			const race = fixture(reversed)
			const vehicle = placed(race, 0)
			const before = requireFixture(path.points[47])
			const after = requireFixture(path.points[53])
			const length = Math.hypot(after.x - before.x, after.y - before.y)
			const sign = reversed ? -1 : 1
			const forward = {
				...vehicle,
				speed: 60,
				vx: ((after.x - before.x) / length) * 60 * sign,
				vy: ((after.y - before.y) / length) * 60 * sign,
			}
			const okay = new LaneMonitor(race)
			observeFor(okay, race, forward, 1)
			expect(okay.issues.some((i) => i.code === 'wrong-way')).toBe(false)
			const wrong = new LaneMonitor(race)
			observeFor(
				wrong,
				race,
				{ ...forward, vx: -forward.vx, vy: -forward.vy },
				1,
			)
			expect(wrong.issues.filter((i) => i.code === 'wrong-way')).toHaveLength(1)
		},
	)
	it('detects no route progress even if a car keeps spinning at speed', () => {
		const race = fixture()
		const monitor = new LaneMonitor(race)
		observeFor(monitor, race, { ...placed(race, 0), speed: 90 }, 7)
		expect(monitor.issues.filter((i) => i.code === 'stalled')).toHaveLength(1)
	})
	it('does not inspect finished cars as stalled or off-road', () => {
		const initial = fixture()
		const vehicle = { ...placed(initial, 55), finishedAt: 1 }
		const race = { ...initial, elapsed: 2, vehicles: [vehicle] }
		const monitor = new LaneMonitor(race)
		observeFor(monitor, race, vehicle, 7)
		expect(monitor.issues).toHaveLength(0)
	})
	it('reports invalid numbers before geometry can disguise them', () => {
		const race = fixture()
		const monitor = new LaneMonitor(race)
		observeFor(monitor, race, { ...placed(race, 0), x: Number.NaN }, 0.1)
		expect(
			monitor.issues.filter((i) => i.code === 'invalid-state'),
		).toHaveLength(1)
	})
	it('records recovery at the original failure location rather than the reset location', () => {
		const race = fixture()
		const monitor = new LaneMonitor(race)
		monitor.observe(
			race,
			{
				state: { ...race, elapsed: 1 / 60 },
				events: [
					{
						type: 'vehicle-recovered',
						vehicleId: requireFixture(race.vehicles[0]).id,
						reason: 'water',
						x: 999,
						y: 888,
						pathIndex: 50,
					},
				],
			},
			1 / 60,
		)
		expect(monitor.issues).toContainEqual(
			expect.objectContaining({
				code: 'recovery',
				severity: 'error',
				x: 999,
				y: 888,
				detail: expect.stringContaining('water'),
			}),
		)
	})
	it.each([false, true])(
		'does not flag crossing the start as a path jump (reversed=%s)',
		(reversed) => {
			const race = fixture(reversed)
			const index = reversed ? 0 : path.points.length - 1
			const nextIndex = reversed ? path.points.length - 1 : 0
			const p = requireFixture(path.points[index])
			const n = requireFixture(path.points[nextIndex])
			const previous = {
				...race,
				vehicles: [
					{ ...requireFixture(race.vehicles[0]), ...p, pathIndex: index },
				],
			}
			const monitor = new LaneMonitor(previous)
			monitor.observe(
				previous,
				{
					state: {
						...race,
						elapsed: 1 / 60,
						vehicles: [
							{
								...requireFixture(race.vehicles[0]),
								x: n.x,
								y: n.y,
								pathIndex: nextIndex,
								speed: 120,
							},
						],
					},
					events: [],
				},
				1 / 60,
			)
			expect(monitor.issues.some((i) => i.code === 'path-jump')).toBe(false)
		},
	)
	it('flags planned lanes outside the road bounds', () => {
		const race = fixture()
		const vehicle = placed(race, 0)
		const monitor = new LaneMonitor(race)
		observeFor(
			monitor,
			race,
			{ ...vehicle, ai: { ...requireFixture(vehicle.ai), targetLane: 200 } },
			0.1,
		)
		expect(
			monitor.issues.filter((i) => i.code === 'invalid-lane'),
		).toHaveLength(1)
	})
})
