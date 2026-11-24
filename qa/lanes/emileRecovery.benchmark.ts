import { RaceSession } from '@/application/race/raceSession'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { decodeTrackInput } from './scenarios'
import { CAR_IDS, type CarId, type DifficultyId } from '@/domain/model'
import { courseIdentity } from '@/application/race/raceRecords'
import { EMILE_COURSE } from '@/domain/race/ai/emileRacingLines'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { RACE_TICK_SECONDS, stepRace } from '@/domain/race/raceEngine'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import type { RaceState } from '@/domain/race/raceState'

// Real exported circuit, including terrain, start direction, checkpoints and scenery.
function loadCircuit() {
	const [track] = decodeTrackInput(
		JSON.parse(readFileSync('tests/fixtures/emile.trackforge.json', 'utf8')),
	)
	if (!track) throw new Error('Missing Émile circuit')
	return track
}
const track = loadCircuit()
// The release identity must preserve the intended authored driving lines.
if (courseIdentity(track) !== EMILE_COURSE) throw new Error('Émile AI racing line identity drift')
const geometry = new TrackGeometryService()
function raceSeed(seed: number, laps = 1, difficulty: DifficultyId = 'hard', playerCar: CarId = 'blue') {
	let value = seed >>> 0
	const random = {
		next() {
			value = (Math.imul(value, 1664525) + 1013904223) >>> 0
			return value / 2 ** 32
		},
	}
	const session = new RaceSession({
		geometry,
		random,
		scoreStore: { forTrack: () => [], record: () => true, removeTrack: () => true },
		feedback: { unlock() {}, setEnabled() {}, handle() {}, silenceContinuous() {}, destroy() {} },
	})
	session.start(track, { car: playerCar, difficulty, laps })
	const initial = session.snapshot().state
	session.destroy()
	if (!initial) throw new Error('Missing Émile race')
	let race: RaceState = { ...initial, phase: 'running', countdown: 0 }
	const rivalRecoveries: { vehicleId: string; time: number; reason: string; pathIndex: number }[] = []
	const offRoad = new Map<string, { seconds: number; maxDistance: number; longExcursions: number; current: number }>()
	const gateHistory: { car: CarId; time: number; lap: number; nextSector: number; pathIndex: number; distance: number }[] = []
	for (let i = 0; i < 90 / RACE_TICK_SECONDS; i++) {
		const result = stepRace(
			race,
			{ steering: 0, throttle: 0, braking: true },
			RACE_TICK_SECONDS,
			random,
		)
		const prior = race
		race = result.state
		for (const car of race.vehicles.filter(v => !v.player)) {
			const previous = prior.vehicles.find(v => v.id === car.id)
			if (!previous || previous.finishedAt !== null) continue
			const context = getVehicleStepContext(race.path, car)
			const stats = offRoad.get(car.id) ?? { seconds: 0, maxDistance: 0, longExcursions: 0, current: 0 }
			if (!context.onRoad && car.grounded) {
				stats.seconds += RACE_TICK_SECONDS
				stats.maxDistance = Math.max(stats.maxDistance, context.nearest.distance)
				stats.current += RACE_TICK_SECONDS
				if (stats.current >= 1 && stats.current < 1 + RACE_TICK_SECONDS) stats.longExcursions++
			} else stats.current = 0
			offRoad.set(car.id, stats)
			if (car.nextSector !== previous.nextSector || car.lap !== previous.lap)
				gateHistory.push({ car: car.car, time: race.elapsed, lap: car.lap, nextSector: car.nextSector, pathIndex: car.pathIndex, distance: context.nearest.distance })
		}
		for (const event of result.events) {
			if (event.type === 'vehicle-recovered' && event.vehicleId !== 'player')
				rivalRecoveries.push({ vehicleId: event.vehicleId, time: race.elapsed, reason: event.reason, pathIndex: event.pathIndex })
		}
		if (
			race.vehicles
				.filter((vehicle) => !vehicle.player)
				.every((vehicle) => vehicle.finishedAt !== null)
		)
			break
	}
	return {
		opponents: race.vehicles.filter((vehicle) => !vehicle.player).map(v => ({ id: v.id, car: v.car, seconds: v.finishedAt, lap: v.lap, nextSector: v.nextSector, pathIndex: v.pathIndex, offRoad: offRoad.get(v.id) })),
		rivalRecoveries, gateHistory,
	}
}

// Diagnostic only: the unchanged domain balance assertions remain the gate.
it('reports production Émile field and recovery telemetry for matched comparisons', () => {
  for (const difficulty of ['hard', 'normal', 'easy'] as const) {
    for (const playerCar of difficulty === 'hard' ? CAR_IDS : (['blue', 'yellow'] as const)) {
      const result = raceSeed(4331, 2, difficulty, playerCar)
      expect(result.opponents).toHaveLength(3)
      console.log('EMILE_DIAGNOSTIC ' + JSON.stringify({ difficulty, playerCar, ...result }))
    }
  }
}, 60000)
