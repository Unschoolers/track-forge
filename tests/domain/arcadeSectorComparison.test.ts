import { expect, it } from 'vitest'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { clamp } from '@/domain/geometry/math'
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing fixture')
	return value
}
const wrapAngle = (angle: number) =>
	Math.atan2(Math.sin(angle), Math.cos(angle))
import type { RaceState } from '@/domain/race/raceState'
import type { RoadPath } from '@/domain/track/pathBuilder'

const hairpin = buildRoadPath(
	[
		{ x: -900, y: 0, surface: 'street' },
		{ x: 0, y: 0, surface: 'street' },
		{ x: 140, y: 0, surface: 'street' },
		{ x: 220, y: 40, surface: 'street' },
		{ x: 220, y: 140, surface: 'street' },
		{ x: 140, y: 180, surface: 'street' },
		{ x: -500, y: 180, surface: 'street' },
	],
	EMPTY_TERRAIN,
)

const icyHairpin = buildRoadPath(
	[
		{ x: -900, y: 0, surface: 'ice' },
		{ x: 0, y: 0, surface: 'ice' },
		{ x: 140, y: 0, surface: 'ice' },
		{ x: 220, y: 40, surface: 'ice' },
		{ x: 220, y: 140, surface: 'ice' },
		{ x: 140, y: 180, surface: 'ice' },
		{ x: -500, y: 180, surface: 'ice' },
	],
	EMPTY_TERRAIN,
)

function run(
	mode: 'early' | 'assist' | 'late',
	threshold = 145,
	preview = 5,
	road: RoadPath = hairpin,
) {
	const base = createRace({
		path: road,
		playerCar: 'blue',
		difficulty: 'normal',
		laps: 2,
		handling: 'arcade',
	})
	const start = required(nearestPathPoint(road, { x: -500, y: 0 })).index
	const point = required(road.points[start])
	let race: RaceState = {
		...base,
		phase: 'running',
		vehicles: [
			{
				...required(base.vehicles[0]),
				x: point.x,
				y: point.y,
				angle: 0,
				vx: 220,
				vy: 0,
				speed: 220,
				pathIndex: start,
				pathDistance: point.distance,
			},
		],
	}
	let offRoad = 0,
		recoveries = 0,
		entry = 0,
		exit = 0
	let wasOffRoad = false
	let frame = 0
	for (; frame < 1200; frame++) {
		const car = required(race.vehicles[0])
		const context = getVehicleStepContext(road, car, undefined, 12)
		const target = required(
			road.points[
				Math.min(
					road.points.length - 1,
					context.nearest.index +
						Math.round(clamp(preview + car.speed / 18, 5, 30)),
				)
			],
		)
		const steering = clamp(
			wrapAngle(Math.atan2(target.y - car.y, target.x - car.x) - car.angle) *
				2.5 -
				car.yawRate * 0.38,
			-1,
			1,
		)
		const braking =
			mode === 'early'
				? car.x > -170 && car.x < 100 && car.y < 40 && car.speed > threshold
				: mode === 'late'
					? car.x > 100 && car.y < 100 && car.speed > 125
					: false
		const result = stepRace(race, { steering, throttle: 1, braking }, 1 / 60, {
			next: () => 0.5,
		})
		race = result.state
		const next = required(race.vehicles[0])
		const off = !getVehicleStepContext(road, next, undefined, 12).onRoad
		if (off && !wasOffRoad) offRoad++
		wasOffRoad = off
		recoveries += result.events.filter(
			(event) => event.type === 'vehicle-recovered',
		).length
		if (!entry && next.x > 100 && next.y < 80) entry = next.speed
		if (next.y > 150 && next.x < 100) {
			exit = next.speed
			break
		}
	}
	return { entry, exit, seconds: frame / 60, offRoad, recoveries }
}
it('a longer preview gains time on the street hairpin even with early braking', () => {
	const clean = run('early', 145, 10)
	const assisted = run('assist')
	const late = run('late')
	const sameLineAssisted = run('assist', 145, 10)
	expect(clean.exit).toBeGreaterThan(0)
	expect(clean.seconds).toBeLessThan(assisted.seconds)
	expect(clean.seconds).toBeLessThan(late.seconds)
	// Braking alone costs time on this line; the longer preview earns the gain.
	expect(sameLineAssisted.seconds).toBeLessThan(clean.seconds)
	expect([clean, assisted, late].map((result) => result.offRoad)).toEqual([
		0, 0, 0,
	])
	expect([clean, assisted, late].map((result) => result.recoveries)).toEqual([
		0, 0, 0,
	])
})

it('records the cost of late braking on the same icy hairpin', () => {
	const early = run('early', 100, 10, icyHairpin)
	const assisted = run('assist', 145, 5, icyHairpin)
	const late = run('late', 145, 5, icyHairpin)
	expect(
		[early.exit, assisted.exit, late.exit].every((speed) => speed > 0),
	).toBe(true)
	expect(late.seconds).toBeGreaterThan(assisted.seconds)
	expect([early, assisted, late].map((result) => result.offRoad)).toEqual([
		1, 1, 1,
	])
	expect([early, assisted, late].map((result) => result.recoveries)).toEqual([
		0, 0, 0,
	])
})

const ramp = buildRoadPath(
	[
		{ x: -700, y: 0, surface: 'street' },
		{ x: 0, y: 0, surface: 'street', structure: 'overpass' },
		{ x: 1000, y: 0, surface: 'street' },
		{ x: 1700, y: 0, surface: 'street' },
	],
	EMPTY_TERRAIN,
)

function runDownhill(mode: 'early' | 'assist' | 'late') {
	const base = createRace({
		path: ramp,
		playerCar: 'blue',
		difficulty: 'normal',
		laps: 2,
		handling: 'arcade',
	})
	const index = ramp.points.findIndex(
		(_, i) => ramp.roadSurface.gradeAt(i) < -0.025,
	)
	const point = required(ramp.points[index])
	const support = ramp.roadSurface.at(index, point)
	let race: RaceState = {
		...base,
		phase: 'running',
		vehicles: [
			{
				...required(base.vehicles[0]),
				x: point.x,
				y: point.y,
				angle: 0,
				vx: 180,
				vy: 0,
				speed: 180,
				pathIndex: index,
				pathDistance: point.distance,
				z: support.height,
				grounded: true,
				structureRunId: support.structureRunId,
			},
		],
	}
	let offRoad = 0,
		recoveries = 0,
		wasOffRoad = false
	let frame = 0
	for (; frame < 300 && required(race.vehicles[0]).x < point.x + 250; frame++) {
		const x = required(race.vehicles[0]).x - point.x
		const braking =
			mode === 'early' ? x < 50 : mode === 'late' ? x > 150 && x < 200 : false
		const result = stepRace(
			race,
			{ steering: 0, throttle: 1, braking },
			1 / 60,
			{ next: () => 0.5 },
		)
		race = result.state
		const off = !getVehicleStepContext(ramp, required(race.vehicles[0])).onRoad
		if (off && !wasOffRoad) offRoad++
		wasOffRoad = off
		recoveries += result.events.filter(
			(event) => event.type === 'vehicle-recovered',
		).length
	}
	return {
		entry: 180,
		exit: required(race.vehicles[0]).speed,
		seconds: frame / 60,
		offRoad,
		recoveries,
	}
}

it('carries speed down a straight unless the driver brakes', () => {
	const early = runDownhill('early'),
		assist = runDownhill('assist'),
		late = runDownhill('late')
	expect(assist.exit).toBeGreaterThan(early.exit)
	expect(assist.seconds).toBeLessThan(early.seconds)
	expect(assist.seconds).toBeLessThan(late.seconds)
	expect([early, assist, late].map((result) => result.offRoad)).toEqual([
		0, 0, 0,
	])
	expect([early, assist, late].map((result) => result.recoveries)).toEqual([
		0, 0, 0,
	])
})
