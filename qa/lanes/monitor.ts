import { ROAD_GEOMETRY } from '@/domain/config'
import type { CarId } from '@/domain/model'
import type { RaceStepResult } from '@/domain/race/raceEngine'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { getVehicleStepContext } from '@/domain/race/trackContext'

export type LaneIssueCode =
	| 'off-road'
	| 'lane-deviation'
	| 'wrong-way'
	| 'stalled'
	| 'path-jump'
	| 'invalid-state'
	| 'invalid-lane'
	| 'recovery'
	| 'collision'
	| 'timeout'

export interface LaneLocation {
	readonly time: number
	readonly vehicleId: string
	readonly x: number
	readonly y: number
	readonly pathIndex: number
	readonly sectionId: string
}
export interface LaneIssue extends LaneLocation {
	readonly code: LaneIssueCode
	readonly severity: 'warning' | 'error'
	readonly detail: string
}
export interface LaneSample extends LaneLocation {
	readonly car: CarId
	readonly z: number
	readonly speed: number
	readonly lane: number
	readonly targetLane: number
	readonly onRoad: boolean
	readonly grounded: boolean
	readonly phase: string
}
export interface VehicleMetrics {
	readonly vehicleId: string
	readonly car: CarId
	readonly finishedAt: number | null
	readonly laps: number
	readonly maxLaneError: number
	readonly offRoadSeconds: number
	readonly recoveries: number
}
interface Observation {
	durations: Partial<Record<LaneIssueCode, number>>
	active: Set<LaneIssueCode>
	progress: number
	bestProgress: number
	lastProgressTime: number
	metrics: VehicleMetrics
}

const finiteVehicle = (v: RaceVehicle) =>
	[
		v.x,
		v.y,
		v.z,
		v.vx,
		v.vy,
		v.angle,
		v.speed,
		v.yawRate,
		v.lane,
		v.pathIndex,
		v.pathDistance,
		v.verticalVelocity,
		v.ai?.targetLane ?? 0,
		v.ai?.steer ?? 0,
	].every(Number.isFinite)

export function sampleLaneVehicle(
	race: RaceState,
	vehicle: RaceVehicle,
): LaneSample {
	const context = getVehicleStepContext(race.path, vehicle)
	const lane =
		(vehicle.x - context.nearest.point.x) * context.normal.x +
		(vehicle.y - context.nearest.point.y) * context.normal.y
	return {
		time: race.elapsed,
		vehicleId: vehicle.id,
		car: vehicle.car,
		x: vehicle.x,
		y: vehicle.y,
		z: vehicle.z,
		pathIndex: vehicle.pathIndex,
		sectionId: context.nearest.point.sectionId,
		speed: vehicle.speed,
		lane,
		targetLane: vehicle.ai?.targetLane ?? lane,
		onRoad: context.onRoad,
		grounded: vehicle.grounded,
		phase: vehicle.ai?.phase ?? 'unknown',
	}
}

export class LaneMonitor {
	readonly issues: LaneIssue[] = []
	samples: LaneSample[] = []
	private readonly observations = new Map<string, Observation>()

	constructor(initial: RaceState) {
		for (const vehicle of initial.vehicles) {
			this.observations.set(vehicle.id, {
				durations: {},
				active: new Set(),
				progress: 0,
				bestProgress: 0,
				lastProgressTime: initial.elapsed,
				metrics: {
					vehicleId: vehicle.id,
					car: vehicle.car,
					finishedAt: null,
					laps: 0,
					maxLaneError: 0,
					offRoadSeconds: 0,
					recoveries: 0,
				},
			})
		}
	}

	metrics(): VehicleMetrics[] {
		return [...this.observations.values()].map(({ metrics }) => ({
			...metrics,
		}))
	}

	private location(race: RaceState, vehicle: RaceVehicle): LaneLocation {
		const point = race.path.points[vehicle.pathIndex] ?? race.path.points[0]
		return {
			time: race.elapsed,
			vehicleId: vehicle.id,
			x: Number.isFinite(vehicle.x) ? vehicle.x : (point?.x ?? 0),
			y: Number.isFinite(vehicle.y) ? vehicle.y : (point?.y ?? 0),
			pathIndex: Number.isInteger(vehicle.pathIndex) ? vehicle.pathIndex : 0,
			sectionId: point?.sectionId ?? 'unknown',
		}
	}

	private condition(
		observation: Observation,
		sample: LaneLocation,
		code: LaneIssueCode,
		condition: boolean,
		duration: number,
		dt: number,
		severity: LaneIssue['severity'],
		detail: string,
	): void {
		if (!condition) {
			observation.durations[code] = 0
			observation.active.delete(code)
			return
		}
		const elapsed = (observation.durations[code] ?? 0) + dt
		observation.durations[code] = elapsed
		if (elapsed + 1e-9 < duration || observation.active.has(code)) return
		observation.active.add(code)
		this.issues.push({ ...sample, code, severity, detail })
	}

	observe(previous: RaceState, result: RaceStepResult, dt: number): void {
		const race = result.state
		this.samples = []
		const recovered = new Set<string>()
		const alreadyFinished = new Set(
			previous.vehicles
				.filter((vehicle) => vehicle.finishedAt !== null)
				.map((vehicle) => vehicle.id),
		)
		for (const event of result.events) {
			if (event.type === 'vehicle-recovered') {
				if (alreadyFinished.has(event.vehicleId)) continue
				recovered.add(event.vehicleId)
				this.issues.push({
					time: race.elapsed,
					vehicleId: event.vehicleId,
					x: event.x,
					y: event.y,
					pathIndex: event.pathIndex,
					sectionId: race.path.points[event.pathIndex]?.sectionId ?? 'unknown',
					code: 'recovery',
					severity: 'error',
					detail: `Automatic ${event.reason} recovery`,
				})
				const observation = this.observations.get(event.vehicleId)
				if (observation) {
					observation.metrics = {
						...observation.metrics,
						recoveries: observation.metrics.recoveries + 1,
					}
					observation.lastProgressTime = race.elapsed
				}
			} else if (
				event.type === 'collision' ||
				event.type === 'barrier-collision'
			) {
				const ids =
					event.type === 'collision'
						? [event.leftId, event.rightId]
						: [event.vehicleId]
				for (const id of ids) {
					if (alreadyFinished.has(id)) continue
					const vehicle = race.vehicles.find((v) => v.id === id)
					if (vehicle)
						this.issues.push({
							...this.location(race, vehicle),
							code: 'collision',
							severity: 'warning',
							detail: `${event.type}, strength ${event.strength.toFixed(1)}`,
						})
				}
			}
		}
		for (const vehicle of race.vehicles) {
			const observation = this.observations.get(vehicle.id)
			if (!observation) continue
			observation.metrics = {
				...observation.metrics,
				finishedAt: vehicle.finishedAt,
				laps: vehicle.lap,
			}
			if (alreadyFinished.has(vehicle.id)) {
				if (finiteVehicle(vehicle))
					this.samples.push(sampleLaneVehicle(race, vehicle))
				continue
			}
			const location = this.location(race, vehicle)
			const valid =
				finiteVehicle(vehicle) &&
				Number.isInteger(vehicle.pathIndex) &&
				vehicle.pathIndex >= 0 &&
				vehicle.pathIndex < race.path.points.length
			this.condition(
				observation,
				location,
				'invalid-state',
				!valid,
				0,
				dt,
				'error',
				'Non-finite or invalid vehicle state',
			)
			if (!valid) continue
			const context = getVehicleStepContext(race.path, vehicle)
			const lane =
				(vehicle.x - context.nearest.point.x) * context.normal.x +
				(vehicle.y - context.nearest.point.y) * context.normal.y
			const targetLane = vehicle.ai?.targetLane ?? lane
			const laneError = Math.abs(lane - targetLane)
			const sample: LaneSample = {
				...location,
				car: vehicle.car,
				z: vehicle.z,
				speed: vehicle.speed,
				lane,
				targetLane,
				onRoad: context.onRoad,
				grounded: vehicle.grounded,
				phase: vehicle.ai?.phase ?? 'unknown',
			}
			this.samples.push(sample)
			observation.metrics = {
				...observation.metrics,
				maxLaneError: Math.max(observation.metrics.maxLaneError, laneError),
				offRoadSeconds:
					observation.metrics.offRoadSeconds + (context.onRoad ? 0 : dt),
			}
			this.condition(
				observation,
				sample,
				'invalid-lane',
				Math.abs(targetLane) > ROAD_GEOMETRY.maxLane,
				0,
				dt,
				'error',
				`Planned lane ${targetLane.toFixed(1)} exceeds road lane bounds`,
			)
			this.condition(
				observation,
				sample,
				'off-road',
				!context.onRoad,
				0.25,
				dt,
				'warning',
				'Off the supported road for at least 0.25 s',
			)
			this.condition(
				observation,
				sample,
				'lane-deviation',
				context.onRoad && laneError > 18,
				1,
				dt,
				'warning',
				`Target lane missed by ${laneError.toFixed(1)} units for at least 1 s`,
			)
			const directedSpeed =
				(vehicle.vx * context.tangent.x + vehicle.vy * context.tangent.y) *
				(race.reversed ? -1 : 1)
			this.condition(
				observation,
				sample,
				'wrong-way',
				context.onRoad && directedSpeed < -15,
				0.75,
				dt,
				'warning',
				'Moving against race direction for at least 0.75 s',
			)
			const before = previous.vehicles.find((v) => v.id === vehicle.id)
			const previousDistance =
				before && race.path.points[before.pathIndex]?.distance
			const distance = race.path.points[vehicle.pathIndex]?.distance
			if (
				previousDistance !== undefined &&
				distance !== undefined &&
				!recovered.has(vehicle.id)
			) {
				let delta = distance - previousDistance
				const length = race.path.totalLength
				if (delta > length / 2) delta -= length
				if (delta < -length / 2) delta += length
				const jump =
					Math.abs(delta) >
					Math.max(
						40,
						Math.max(before?.speed ?? 0, vehicle.speed) * dt * 3 + 12,
					)
				this.condition(
					observation,
					sample,
					'path-jump',
					jump,
					0,
					dt,
					'error',
					`Road progress jumped ${Math.abs(delta).toFixed(1)} units in one physics step`,
				)
				if (!jump) observation.progress += delta * (race.reversed ? -1 : 1)
				if (observation.progress > observation.bestProgress + 6) {
					observation.bestProgress = observation.progress
					observation.lastProgressTime = race.elapsed
				}
			}
			this.condition(
				observation,
				sample,
				'stalled',
				race.elapsed - observation.lastProgressTime >= 5,
				0,
				dt,
				'warning',
				'No forward route progress for at least 5 s',
			)
		}
	}

	timeout(race: RaceState): void {
		for (const vehicle of race.vehicles) {
			if (vehicle.finishedAt === null)
				this.issues.push({
					...this.location(race, vehicle),
					code: 'timeout',
					severity: 'error',
					detail: `Did not finish ${race.totalLaps} lap(s) within ${race.elapsed.toFixed(1)} s`,
				})
		}
	}
}
