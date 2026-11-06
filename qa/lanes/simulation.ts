import type { RandomSource } from '@/application/ports/random'
import {
	CAR_IDS,
	DIFFICULTY_IDS,
	type CarId,
	type DifficultyId,
} from '@/domain/model'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import type { RoadPath } from '@/domain/track/pathBuilder'
import {
	LaneMonitor,
	sampleLaneVehicle,
	type LaneIssue,
	type LaneSample,
	type VehicleMetrics,
} from './monitor'

export interface LaneRunOptions {
	readonly path: RoadPath
	readonly trackName: string
	readonly seed: number
	readonly difficulty: DifficultyId
	readonly reversed: boolean
	readonly startRatio?: number
	readonly seconds: number
	readonly laps: number
	readonly mode: 'solo' | 'traffic'
	readonly car: CarId
}
export interface LaneRun {
	readonly trackName: string
	readonly seed: number
	readonly difficulty: DifficultyId
	readonly reversed: boolean
	readonly startRatio: number
	readonly seconds: number
	readonly laps: number
	readonly mode: 'solo' | 'traffic'
	readonly car: CarId
	readonly steps: number
	readonly simulatedSeconds: number
	readonly stoppedReason: 'finished' | 'timeout' | 'invalid-state'
	readonly road: readonly {
		x: number
		y: number
		sectionId: string
		structure: string
	}[]
	readonly vehicles: readonly VehicleMetrics[]
	readonly samples: readonly LaneSample[]
	readonly issues: readonly LaneIssue[]
}

/** Mulberry32: seeded per run, including all random consumption by race effects. */
function seededRandom(seed: number): RandomSource {
	let state = seed >>> 0
	return {
		next: () => {
			state = (state + 0x6d2b79f5) | 0
			let value = Math.imul(state ^ (state >>> 15), 1 | state)
			value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
			return ((value ^ (value >>> 14)) >>> 0) / 4294967296
		},
	}
}

export function runLaneCheck(options: LaneRunOptions): LaneRun {
	const { path } = options
	if (
		!path.closed ||
		path.points.length < 4 ||
		!Number.isFinite(path.totalLength) ||
		path.totalLength <= 0 ||
		!path.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
	) {
		throw new Error('Lane checker requires a finite closed road path')
	}
	if (
		!Number.isFinite(options.seconds) ||
		options.seconds <= 0 ||
		options.seconds > 600 ||
		!Number.isInteger(options.laps) ||
		options.laps < 1 ||
		options.laps > 10 ||
		!Number.isInteger(options.seed) ||
		options.seed < 0 ||
		options.seed > 0xffff_ffff ||
		!CAR_IDS.includes(options.car) ||
		!DIFFICULTY_IDS.includes(options.difficulty) ||
		!['solo', 'traffic'].includes(options.mode) ||
		(options.startRatio !== undefined &&
			(!Number.isFinite(options.startRatio) ||
				options.startRatio < 0 ||
				options.startRatio >= 1))
	) {
		throw new Error('Invalid lane simulation options')
	}
	const created = createRace({
		path,
		playerCar: options.car,
		difficulty: options.difficulty,
		laps: options.laps,
		reversed: options.reversed,
		startRatio: options.startRatio ?? 0,
	})
	let race: RaceState = {
		...created,
		phase: 'running',
		countdown: 0,
		vehicles: created.vehicles
			.filter((_, index) => options.mode === 'traffic' || index === 0)
			.map((vehicle) => ({
				...vehicle,
				player: false,
				damageLimit: Number.POSITIVE_INFINITY,
				ai: vehicle.ai ?? createAiDriverState(0),
			})),
	}
	const monitor = new LaneMonitor(race)
	const random = seededRandom(options.seed)
	const samples: LaneSample[] = race.vehicles.map((v) =>
		sampleLaneVehicle(race, v),
	)
	const maxSteps = Math.ceil(options.seconds * 60)
	let steps = 0
	let invalid = false
	while (steps < maxSteps && race.vehicles.some((v) => v.finishedAt === null)) {
		const result = stepRace(
			race,
			{ steering: 0, throttle: 0, braking: false },
			1 / 60,
			random,
		)
		monitor.observe(race, result, 1 / 60)
		race = result.state
		steps++
		const latest = monitor.issues.at(-1)
		invalid =
			latest?.code === 'invalid-state' ||
			monitor.issues.some((i) => i.code === 'invalid-state')
		const final =
			invalid ||
			steps === maxSteps ||
			race.vehicles.every((v) => v.finishedAt !== null)
		if (steps % 6 === 0 || final) samples.push(...monitor.samples)
		if (invalid) break
	}
	const finished = race.vehicles.every((v) => v.finishedAt !== null)
	if (!finished && !invalid) monitor.timeout(race)
	return {
		trackName: options.trackName,
		seed: options.seed,
		difficulty: options.difficulty,
		reversed: options.reversed,
		startRatio: options.startRatio ?? 0,
		seconds: options.seconds,
		laps: options.laps,
		mode: options.mode,
		car: options.car,
		steps,
		simulatedSeconds: race.elapsed,
		stoppedReason: invalid
			? 'invalid-state'
			: finished
				? 'finished'
				: 'timeout',
		road: path.points.map(({ x, y, sectionId, structure }) => ({
			x,
			y,
			sectionId,
			structure,
		})),
		vehicles: monitor.metrics(),
		samples,
		issues: monitor.issues,
	}
}
