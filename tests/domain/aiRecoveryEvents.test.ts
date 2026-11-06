import { describe, expect, it } from 'vitest'
import { requireFixture } from '../fixtures/requireFixture'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'

describe('AI recovery telemetry', () => {
	it('reports water recovery separately with the pre-reset location', () => {
		const path = buildRoadPath(
			[
				{ x: -200, y: 16, surface: 'street' },
				{ x: 200, y: 16, surface: 'street' },
				{ x: 200, y: 216, surface: 'street' },
				{ x: -200, y: 216, surface: 'street' },
				{ x: -200, y: 16, surface: 'street' },
			],
			{ cellSize: 32, cells: [{ column: 0, row: 0, kind: 'water' }] },
		)
		const race = createRace({
			path,
			playerCar: 'blue',
			difficulty: 'normal',
			laps: 1,
		})
		const ai = { ...requireFixture(race.vehicles[1]), x: 16, y: 16, z: 0 }
		const result = stepRace(
			{ ...race, phase: 'running', vehicles: [ai] },
			{ steering: 0, throttle: 0, braking: false },
			1 / 60,
			{ next: () => 0.5 },
		)
		expect(result.events).toContainEqual(
			expect.objectContaining({
				type: 'vehicle-recovered',
				vehicleId: ai.id,
				reason: 'water',
				x: expect.closeTo(16, 0),
				y: expect.closeTo(16, 0),
			}),
		)
	})
	it('reports an off-road reset at the failure position before snapping to road', () => {
		const track = createStarterTrack(asTrackId('recovery-event'), 1)
		const path = buildRoadPath(track.points, track.terrain)
		const race = createRace({
			path,
			playerCar: 'blue',
			difficulty: 'normal',
			laps: 1,
		})
		const ai = requireFixture(race.vehicles[1])
		const lost = { ...ai, x: 4000, y: 4000 }
		const result = stepRace(
			{ ...race, phase: 'running', vehicles: [lost] },
			{ steering: 0, throttle: 0, braking: false },
			1 / 60,
			{ next: () => 0.5 },
		)
		expect(result.events).toContainEqual(
			expect.objectContaining({
				type: 'vehicle-recovered',
				vehicleId: ai.id,
				reason: 'off-road',
				x: expect.any(Number),
				y: expect.any(Number),
				pathIndex: expect.any(Number),
			}),
		)
		const event = result.events.find(
			(event) => event.type === 'vehicle-recovered',
		)
		expect(event).toMatchObject({
			x: expect.closeTo(4000, 0),
			y: expect.closeTo(4000, 0),
		})
		expect(requireFixture(result.state.vehicles[0]).x).toBeLessThan(1000)
	})
})
