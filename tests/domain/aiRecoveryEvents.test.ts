import { describe, expect, it } from 'vitest'
import { requireFixture } from '../fixtures/requireFixture'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import { advanceRivalOffRoadRecovery, RECOVERY_TUNING } from '@/domain/race/raceRecovery'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import type { RaceState } from '@/domain/race/raceState'
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

describe('off-road grace period', () => {
  const path = buildRoadPath([
    { x: 0, y: 0, surface: 'street' },
    { x: 1000, y: 0, surface: 'street' },
    { x: 1000, y: 1000, surface: 'street' },
    { x: 0, y: 1000, surface: 'street' },
    { x: 0, y: 0, surface: 'street' },
  ], EMPTY_TERRAIN)
  const race = createRace({ path, playerCar: 'blue', difficulty: 'hard', laps: 2 })
  const ai = requireFixture(race.vehicles[1])
  const base = { ...ai, grounded: true, aiOffRoadSeconds: 0 }
  const point = requireFixture(path.points[0])
  const outside = { onRoad: false, nearest: { index: 0, point, distance: 85 } }
  const inside = { onRoad: true, nearest: { index: 0, point, distance: 0 } }
  it('allows 119 ticks off-road, expires at 120 and clears on return', () => {
    let car = base
    for (let i = 0; i < 119; i++) {
      const result = advanceRivalOffRoadRecovery(car, outside, 1 / 60)
      expect(result.expired).toBe(false)
      car = { ...result.vehicle, aiOffRoadSeconds: result.vehicle.aiOffRoadSeconds ?? 0 }
    }
    expect(advanceRivalOffRoadRecovery(car, outside, 1 / 60).expired).toBe(true)
    const returned = advanceRivalOffRoadRecovery(car, inside, 1 / 60)
    expect(returned.expired).toBe(false)
    expect(returned.vehicle.aiOffRoadSeconds).toBe(0)
    expect(advanceRivalOffRoadRecovery(returned.vehicle, outside, 1 / 60).expired).toBe(false)
  })
  it('enforces 100 units as the immediate grounded hard limit, not during jumps', () => {
    expect(advanceRivalOffRoadRecovery(base, { ...outside, nearest: { ...outside.nearest, distance: RECOVERY_TUNING.aiOffRoadDistance } }, 1 / 60).expired).toBe(false)
    const distant = { ...outside, nearest: { ...outside.nearest, distance: 101 } }
    expect(advanceRivalOffRoadRecovery(base, distant, 1 / 60).expired).toBe(true)
    expect(advanceRivalOffRoadRecovery({ ...base, grounded: false }, distant, 1 / 60).expired).toBe(false)
  })
  it('allows a real AI to drive back from the verge without a forced respawn', () => {
    const center = requireFixture(nearestPathPoint(path, { x: 500, y: 0 }))
    const before = requireFixture(path.points[center.index - 2])
    const after = requireFixture(path.points[center.index + 2])
    const angle = Math.atan2(after.y - before.y, after.x - before.x)
    const heading = angle - Math.PI / 2
    const rival = { ...base, pathIndex: center.index, pathDistance: center.point.distance,
      x: center.point.x - Math.sin(angle) * 80, y: center.point.y + Math.cos(angle) * 80,
      angle: heading, speed: 75, vx: Math.cos(heading) * 75, vy: Math.sin(heading) * 75 }
    let running: RaceState = { ...race, phase: 'running', vehicles: [rival] }
    expect(getVehicleStepContext(path, rival).onRoad).toBe(false)
    let returned = false
    for (let i = 0; i < 120; i++) {
      const result = stepRace(running, { steering: 0, throttle: 0, braking: false }, 1 / 60, { next: () => 0.5 })
      expect(result.events.some(event => event.type === 'vehicle-recovered')).toBe(false)
      running = result.state
      if (getVehicleStepContext(path, requireFixture(running.vehicles[0])).onRoad) { returned = true; break }
    }
    expect(returned).toBe(true)
    expect(running.vehicles[0]?.aiOffRoadSeconds).toBe(0)
  })
})
