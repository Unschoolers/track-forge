import { describe, expect, it } from 'vitest'
import { requireFixture } from '../fixtures/requireFixture'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import { createLaneScenarios, prepareLanePath } from '../../qa/lanes/scenarios'

describe('AI recovery telemetry', () => {
	it('recovers a rival that fell below a bridge on the same arm without awarding progress', () => {
		const track = requireFixture(createLaneScenarios().find(({ id }) => id === 'bridge'))
		const path = prepareLanePath(track)
		const crossing = requireFixture(path.crossings.find(({ upperPathIndex }) => upperPathIndex !== null))
		const pathIndex = requireFixture(crossing.upperPathIndex)
		const race = createRace({ path, playerCar: 'blue', difficulty: 'hard', laps: 2 })
		const rival = {
			...requireFixture(race.vehicles[1]), ...crossing.position, pathIndex,
			z: Math.min(crossing.firstHeight, crossing.secondHeight), lap: 1, nextSector: 3 as const,
		}
		const { state, events } = stepRace(
			{ ...race, phase: 'running', vehicles: [rival] },
			{ steering: 0, throttle: 0, braking: false }, 1 / 60, { next: () => 0.5 },
		)
		expect(events).toEqual([expect.objectContaining({ type: 'vehicle-recovered', vehicleId: rival.id })])
		const recovered = requireFixture(state.vehicles[0])
		expect(recovered).toMatchObject({ pathIndex, lap: 1, nextSector: 3, finishedAt: null })
		expect(recovered.z).toBeGreaterThan(rival.z)
	})

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
		const ai = {
			...requireFixture(race.vehicles[1]), x: 16, y: 16, z: 0,
			pathIndex: requireFixture(nearestPathPoint(path, { x: 16, y: 16 })).index,
		}
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
