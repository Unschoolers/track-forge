import { describe, expect, it, vi } from 'vitest'
import { asTrackId, type Track } from '@/domain/model'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { RaceScene } from '@/phaser/scenes/RaceScene'
import { isVehicleAboveStructures } from '@/phaser/rendering/vehicleRenderer'

vi.mock('phaser', () => ({ default: { Scene: class {} } }))

const track: Track = {
	id: asTrackId('ramp-visibility'),
	name: 'Ramp visibility',
	version: 8,
	points: [
		{ x: -300, y: 0, surface: 'street' },
		{ x: 0, y: 0, surface: 'street', structure: 'overpass' },
		{ x: 400, y: 0, surface: 'street' },
		{ x: 400, y: 300, surface: 'street' },
		{ x: -300, y: 300, surface: 'street' },
		{ x: -300, y: 0, surface: 'street' },
	],
	trees: [],
	terrain: EMPTY_TERRAIN,
	lighting: 'day',
	createdAt: 1,
	updatedAt: 1,
}

class Graphics {
	readonly bodies: { x: number; y: number }[] = []
	clear() {
		this.bodies.length = 0
	}
	translateCanvas(x: number, y: number) {
		this.bodies.push({ x, y })
	}
	save() {}
	restore() {}
	rotateCanvas() {}
	fillStyle() {}
	beginPath() {}
	moveTo() {}
	lineTo() {}
	closePath() {}
	fillPath() {}
	fillCircle() {}
	fillEllipse() {}
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing fixture')
	return value
}

describe('ramp vehicle rendering', () => {
  it('retains a known ramp deck layer during a crossing lookup and slight suspension drop', () => {
    const path = buildRoadPath(track.points, track.terrain)
    const race = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 1 })
    const index = path.points.findIndex((point, i) =>
      path.roadSurface.at(i, point).structureHeight > 16 &&
      path.roadSurface.at(i, point).structureHeight < 24)
    expect(index).toBeGreaterThan(0)
    const point = required(path.points[index])
    const surface = path.roadSurface.at(index, point)
    const car = {
      ...required(race.vehicles[0]),
      x: point.x,
      y: point.y,
      z: surface.height - 1,
      pathIndex: index,
      structureRunId: surface.structureRunId,
    }
    expect(isVehicleAboveStructures(car, path)).toBe(true)
    expect(isVehicleAboveStructures({
      ...car, z: 0, structureRunId: null,
    }, path)).toBe(false)
  })

	it.each([false, true])(
		'draws all cars above every supported ramp sample (reverse=%s)',
		(reversed) => {
			const path = buildRoadPath(track.points, track.terrain)
			const base = createRace({
				path,
				playerCar: 'blue',
				difficulty: 'normal',
				laps: 2,
				reversed,
			})
			const upper = new Graphics()
			const lower = new Graphics()
			const scene = {
				snapshot: {},
				controller: { snapshot: () => ({ preferences: { lighting: 'day' } }) },
				controls: {
					snapshot: () => ({ steering: 0, throttle: 1, braking: false }),
				},
				vehicleGraphics: lower,
				upperVehicleGraphics: upper,
				shadowGraphics: new Graphics(),
				effectGraphics: new Graphics(),
				game: { loop: { rawDelta: 16 } },
				raceSession: { advance() {}, snapshot: () => ({ state: current }) },
			}
			let current = { ...base, phase: 'running' as const }
			let lowRampSamples = 0
			for (const [index, point] of path.points.entries()) {
				const road = path.roadSurface.at(index, point)
				if (road.structureRunId === null || road.structureHeight <= 0.005)
					continue
				if (road.structureHeight < 10.8) lowRampSamples++
				current = {
					...current,
					vehicles: base.vehicles.map((vehicle) => ({
						...vehicle,
						x: point.x,
						y: point.y,
						z: road.height,
						pathIndex: index,
						structureRunId: road.structureRunId,
					})),
				}
				expect(
					getVehicleStepContext(path, required(current.vehicles[0])).onRoad,
				).toBe(true)
				RaceScene.prototype.update.call(scene as never, 0, 16)
				expect(
					upper.bodies,
					`ramp index ${index}, height ${road.height}`,
				).toHaveLength(4)
				expect(lower.bodies).toHaveLength(0)
			}
			expect(lowRampSamples).toBeGreaterThan(4)
		},
	)

	it('keeps ground-level traffic below an overhead deck', () => {
		const path = buildRoadPath(track.points, track.terrain)
		const base = createRace({
			path,
			playerCar: 'blue',
			difficulty: 'normal',
			laps: 2,
		})
		const index = path.points.findIndex(
			(_, i) => path.roadSurface.at(i).structureHeight === 24,
		)
		const point = required(path.points[index])
		const upper = new Graphics()
		const lower = new Graphics()
		const state = {
			...base,
			vehicles: [
				{
					...required(base.vehicles[0]),
					x: point.x,
					y: point.y,
					pathIndex: index,
					z: 0,
					structureRunId: null,
				},
			],
		}
		const scene = {
			snapshot: {},
			controller: { snapshot: () => ({ preferences: { lighting: 'day' } }) },
			controls: {
				snapshot: () => ({ steering: 0, throttle: 1, braking: false }),
			},
			vehicleGraphics: lower,
			upperVehicleGraphics: upper,
			shadowGraphics: new Graphics(),
			effectGraphics: new Graphics(),
			game: { loop: { rawDelta: 16 } },
			raceSession: { advance() {}, snapshot: () => ({ state }) },
		}
		RaceScene.prototype.update.call(scene as never, 0, 16)
		expect(lower.bodies).toHaveLength(1)
		expect(upper.bodies).toHaveLength(0)
	})
})
