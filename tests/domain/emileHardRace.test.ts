import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTrackInput } from '../../qa/lanes/scenarios'
import { normalizeRouteKind } from '@/domain/model'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { createRace } from '@/domain/race/raceFactory'
import { RACE_TICK_SECONDS, stepRace } from '@/domain/race/raceEngine'

// Real exported circuit, including terrain, start direction, checkpoints and scenery.
function loadCircuit() {
	const [track] = decodeTrackInput(
		JSON.parse(readFileSync('tests/fixtures/emile.trackforge.json', 'utf8')),
	)
	if (!track) throw new Error('Missing Émile circuit')
	return track
}
const track = loadCircuit()
const path = new TrackGeometryService().get(track).path
const ghostSeconds = 31.633

function raceSeed(seed: number) {
	let race = createRace({
		path,
		routeKind: normalizeRouteKind(track.routeKind),
		recoveryCheckpoints: track.recoveryCheckpoints,
		recoveryScenery: track,
		playerCar: 'blue',
		difficulty: 'hard',
		handling: 'arcade',
		laps: 1,
		startRatio: track.start?.ratio,
		reversed: track.start?.reversed,
	})
	race = { ...race, phase: 'running', countdown: 0 }
	let value = seed >>> 0
	const random = {
		next() {
			value = (Math.imul(value, 1664525) + 1013904223) >>> 0
			return value / 2 ** 32
		},
	}
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
			expect(opponents[0]?.finishedAt).toBeLessThan(ghostSeconds + 1.5)
		},
		30000,
	)
})
