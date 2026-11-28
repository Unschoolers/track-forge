import type { RandomSource } from '@/application/ports/random'
import {
	CAR_IDS,
	DIFFICULTY_IDS,
	type CarId,
	type DifficultyId,
} from '@/domain/model'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import type { AiDecisionTelemetry } from '@/domain/race/ai/aiDriver'
import { createRace } from '@/domain/race/raceFactory'
import { validNearbyGridPositions } from '@/domain/race/startGrid'
import { stepRace, type RaceStepResult } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
import type { RoadPath } from '@/domain/track/pathBuilder'
import { authoredCheckpointsForPath } from './scenarios'
import type { CarDrivingProfile } from '@/domain/race/ai/aiCarDrivingProfiles'
import { validatePassingPolicy, type CarPassingPolicy } from '@/domain/race/ai/aiCarPassingPolicies'
import {
	LaneMonitor,
	sampleLaneVehicle,
	type LaneIssue,
	type LaneSample,
	type VehicleMetrics,
} from './monitor'

export interface LaneRunOptions {
	/** Optional offline observer of authoritative 60 Hz ticks; never modifies race state. */
	readonly observeStep?: (previous: RaceState, result: RaceStepResult) => void
	/** Optional 10 Hz trace of decisions made by the real AI controller. */
	readonly captureAiDecisions?: boolean
	readonly path: RoadPath
	readonly trackName: string
	readonly seed: number
	readonly difficulty: DifficultyId
	readonly reversed: boolean
	readonly startRatio?: number
	/** Match exported race starting slots for reproducible traffic diagnostics. */
	readonly gridPositions?: readonly number[]
	/** Simulation-only, race-local AI driving profiles (no shared mutation). */
	readonly aiProfileOverrides?: Readonly<Partial<Record<CarId, CarDrivingProfile>>>
	/** A pass policy changes only the named car, never the other simulated cars. */
	readonly aiPassingPolicyOverrides?: Readonly<Partial<Record<CarId, CarPassingPolicy>>>
	/** Offline control for a matched legacy-versus-compact AI traffic study. */
	readonly aiAiTrafficMode?: 'legacy' | 'compact'
	/** Required in duel mode; the second AI has this physical chassis. */
	readonly duelOpponentCar?: CarId
	/** Duel-only: physical opponent drives its own AI at this pace multiplier. */
	readonly duelOpponentSpeedLimit?: number
	readonly seconds: number
	readonly laps: number
	readonly mode: 'solo' | 'duel' | 'traffic'
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
	readonly mode: 'solo' | 'duel' | 'traffic'
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
	readonly aiDecisions?: readonly (AiDecisionTelemetry & { readonly vehicleId: string; readonly time: number })[]
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
		!['solo', 'duel', 'traffic'].includes(options.mode) ||
		(options.mode === 'duel' && (options.duelOpponentCar === undefined || !CAR_IDS.includes(options.duelOpponentCar))) ||
		(options.mode !== 'duel' && options.duelOpponentCar !== undefined) ||
		(options.aiAiTrafficMode !== undefined && !['legacy', 'compact'].includes(options.aiAiTrafficMode)) ||
		(options.duelOpponentSpeedLimit !== undefined && (
			options.mode !== 'duel' || !Number.isFinite(options.duelOpponentSpeedLimit) ||
			options.duelOpponentSpeedLimit < 100 || options.duelOpponentSpeedLimit > 350)) ||
		(options.startRatio !== undefined &&
			(!Number.isFinite(options.startRatio) ||
				options.startRatio < 0 ||
				options.startRatio >= 1)) ||
		(options.gridPositions !== undefined &&
			!validNearbyGridPositions(options.gridPositions))
	) {
		throw new Error('Invalid lane simulation options')
	}
	for (const policy of Object.values(options.aiPassingPolicyOverrides ?? {})) {
		if (policy) validatePassingPolicy(policy)
	}
	const created = createRace({
		path,
		recoveryCheckpoints: authoredCheckpointsForPath(path),
		playerCar: options.car,
		difficulty: options.difficulty,
		laps: options.laps,
		reversed: options.reversed,
		startRatio: options.startRatio ?? 0,
		gridPositions: options.gridPositions ?? (options.mode === 'duel' ? [2, 0, 1, 3] : undefined),
	})
	const duelOpponentId = created.vehicles[1]?.id
	if (options.mode === 'duel' && !duelOpponentId)
		throw new Error('Duel opponent missing from race grid')
	let duelSpeedLimits: Readonly<Record<string, number>> | undefined
	if (options.duelOpponentSpeedLimit !== undefined) {
		if (!duelOpponentId) throw new Error('Duel speed limit requires a rival')
		duelSpeedLimits = { [duelOpponentId]: options.duelOpponentSpeedLimit }
	}
	let race: RaceState = {
		...created,
		...(duelSpeedLimits ? { aiVehicleSpeedLimits: duelSpeedLimits } : {}),
		...(options.aiProfileOverrides ? { aiProfileOverrides: options.aiProfileOverrides } : {}),
		...(options.aiPassingPolicyOverrides ? { aiPassingPolicyOverrides: options.aiPassingPolicyOverrides } : {}),
		...(options.aiAiTrafficMode ? { aiAiTrafficMode: options.aiAiTrafficMode } : {}),
		phase: 'running',
		countdown: 0,
		vehicles: created.vehicles
			.filter((_, index) => options.mode === 'traffic' || index === 0 ||
				(options.mode === 'duel' && index === 1))
			.map((vehicle, index) => ({
				...vehicle,
				// A duel's rival is an actual physical vehicle from the real grid,
				// with a selectable chassis, not a frozen obstacle or fake telemetry.
				...(options.mode === 'duel' && index === 1 ? {
					car: options.duelOpponentCar ?? vehicle.car,
					
				} : {}),
				player: false,
				ai: vehicle.ai ?? createAiDriverState(0),
			})),
	}
	const monitor = new LaneMonitor(race)
	const random = seededRandom(options.seed)
	const samples: LaneSample[] = race.vehicles.map((v) =>
		sampleLaneVehicle(race, v),
	)
	const aiDecisions: (AiDecisionTelemetry & { vehicleId: string; time: number })[] = []
	const maxSteps = Math.ceil(options.seconds * 60)
	let steps = 0
	let invalid = false
	const observeAiDecision = options.captureAiDecisions
		? (vehicleId: string, decision: AiDecisionTelemetry) => {
			if (steps % 6 === 0) {
				aiDecisions.push({ vehicleId, time: race.elapsed, ...decision })
			}
		}
		: undefined
	while (steps < maxSteps && race.vehicles.some((v) => v.finishedAt === null)) {
		const result = stepRace(
			race,
			{ steering: 0, throttle: 0, braking: false },
			1 / 60,
			random,
			observeAiDecision,
		)
		options.observeStep?.(race, result)
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
		...(options.captureAiDecisions ? { aiDecisions } : {}),
		issues: monitor.issues,
	}
}
