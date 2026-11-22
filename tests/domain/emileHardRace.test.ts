import { RaceSession } from '@/application/race/raceSession'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrackInput } from '../../qa/lanes/scenarios'
import { CAR_IDS, type CarId, type DifficultyId } from '@/domain/model'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { RACE_TICK_SECONDS, stepRace } from '@/domain/race/raceEngine'
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
const geometry = new TrackGeometryService()
const ghostSeconds = 31.633

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
	session.start(track, { car: playerCar, difficulty, laps, handling: 'arcade' })
	const initial = session.snapshot().state
	session.destroy()
	if (!initial) throw new Error('Missing Émile race')
	let race: RaceState = { ...initial, phase: 'running', countdown: 0 }
	const rivalRecoveries = []
	for (let i = 0; i < 90 / RACE_TICK_SECONDS; i++) {
		const result = stepRace(
			race,
			{ steering: 0, throttle: 0, braking: true },
			RACE_TICK_SECONDS,
			random,
		)
		race = result.state
		for (const event of result.events) {
			if (event.type === 'vehicle-recovered' && event.vehicleId !== 'player')
				rivalRecoveries.push(event.vehicleId)
		}
		if (
			race.vehicles
				.filter((vehicle) => !vehicle.player)
				.every((vehicle) => vehicle.finishedAt !== null)
		)
			break
	}
	return {
		opponents: race.vehicles.filter((vehicle) => !vehicle.player),
		rivalRecoveries,
	}
}

describe('Émile hard arcade race', () => {
	it.each([1, 4331, 98765])(
		'finishes with the original grid and scenery (seed %i)',
		(seed) => {
			const { opponents, rivalRecoveries } = raceSeed(seed)
			expect(opponents.map((vehicle) => vehicle.car)).toEqual([
				'blue',
				'red',
				'green',
			])
			expect(rivalRecoveries).toEqual([])
			for (const vehicle of opponents) {
				expect(vehicle.finishedAt).not.toBeNull()
				expect(vehicle.finishedAt).toBeLessThan(ghostSeconds + 3)
			}
			// The mirror rival uses the same Blue car as the recorded ghost.
			expect(opponents[0]?.finishedAt).toBeLessThan(30.616)
		},
		30000,
	)
})

describe('Émile arcade difficulty balance', () => {
	const hardRuns = new Map<CarId, ReturnType<typeof raceSeed>>()
	function hardRun(car: CarId) {
		const existing = hardRuns.get(car)
		if (existing) return existing
		const run = raceSeed(4331, 2, 'hard', car)
		hardRuns.set(car, run)
		return run
	}

	it('keeps the Hard field close over two laps in all four starting grids', () => {
		let redWins = 0
		for (const playerCar of CAR_IDS) {
			const { opponents } = hardRun(playerCar)
			const times = opponents.map(({ finishedAt }) => finishedAt ?? Infinity)
			const fastest = Math.min(...times)
			// A 5/5-speed car is intentionally faster than a 2/5-speed car.
			// Keep the field within a 10% relative pace window across real car specs
			// and grid positions rather than artificially matching finish times.
			expect((Math.max(...times) - fastest) / fastest,
				`${playerCar}: ${opponents.map(rival => `${rival.car}=${rival.finishedAt?.toFixed(3) ?? 'DNF'}`).join(', ')}`,
			).toBeLessThan(0.10)
			const redTime = opponents.find(({ car }) => car === 'red')?.finishedAt
			if (redTime === fastest) redWins++
			if (playerCar === 'blue') expect(redTime).toBeLessThan(61.866)
		}
		expect(redWins).toBeGreaterThan(0)
	}, 30000)

	it('gives Medium and Easy progressively lower race pace', () => {
		const meanTime = (difficulty: DifficultyId) => {
			const times = (['blue', 'yellow'] as const).flatMap((playerCar) => {
				const run = difficulty === 'hard' ? hardRun(playerCar) : raceSeed(4331, 2, difficulty, playerCar)
				return run.opponents.map(({ finishedAt }) => finishedAt ?? Infinity)
			})
			return times.reduce((sum, time) => sum + time, 0) / times.length
		}
		const hard = meanTime('hard')
		const normal = meanTime('normal')
		const easy = meanTime('easy')
		const mediumPace = hard / normal
		const easyPace = hard / easy
		expect(mediumPace, `hard=${hard.toFixed(3)}s normal=${normal.toFixed(3)}s`).toBeGreaterThan(0.925)
		expect(mediumPace).toBeLessThan(0.975)
		expect(easyPace).toBeGreaterThan(0.875)
		expect(easyPace).toBeLessThan(0.925)
	}, 30000)
})
