import { describe, expect, it, vi } from 'vitest'
import { CAR_IDS, asTrackId, type Track, type Vector2 } from '@/domain/model'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { buildBridgePresentation, getBridgeDeckOcclusion, renderBridgeDeck, type BridgePolygonPrimitive } from '@/phaser/rendering/bridgeRenderer'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createRace } from '@/domain/race/raceFactory'
import { captureRaceSnapshot } from '@/domain/race/raceSnapshot'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import { RaceScene } from '@/phaser/scenes/RaceScene'
import { isVehicleAboveStructures, renderVehicles } from '@/phaser/rendering/vehicleRenderer'
import { VEHICLE_VISUAL_SCALE, vehiclePaintColor } from '@/presentation/vehicleArtwork'

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

// The player's cosmetic topper has its own scale transform; record car paint separately.
const BODY_PAINT_COLORS = new Set(CAR_IDS.map(car => vehiclePaintColor(car, 'body')))

class Graphics {
	readonly bodies: { x: number; y: number }[] = []
	readonly scales: { x: number; y: number }[] = []
	readonly shadows: { x: number; y: number }[] = []
	readonly outlines: { x: number; y: number }[] = []
	private position = { x: 0, y: 0 }
	private strokeWidth = 0
	strokes = 0
	clear() {
		this.bodies.length = 0
		this.scales.length = 0
		this.shadows.length = 0
		this.outlines.length = 0
		this.strokes = 0
	}
	translateCanvas(x: number, y: number) {
		this.position = { x, y }
	}
	save() {}
	restore() {}
	rotateCanvas() {}
	// Scaling is not evidence of a vehicle: the topper scales independently.
	scaleCanvas(x: number, y: number) {
		this.scales.push({ x, y })
	}
	fillStyle(color: number) {
		if (BODY_PAINT_COLORS.has(color)) this.bodies.push({ ...this.position })
	}
	beginPath() {}
	moveTo() {}
	lineTo() {}
	closePath() {}
	fillPath() {}
	lineStyle(width: number) { this.strokeWidth = width }
	strokePath() {
		this.strokes++
		if (this.strokeWidth === 4) this.outlines.push({ ...this.position })
	}
	fillCircle() {}
	fillEllipse() {
		this.shadows.push({ ...this.position })
	}
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing fixture')
	return value
}

describe('ramp vehicle rendering', () => {
  it('draws both ramp entrances below ground-level cars and leaves the deck above them', () => {
    const geometry = buildTrackGeometry(track)
    const decks = buildBridgePresentation(geometry).filter(
      (primitive): primitive is BridgePolygonPrimitive => primitive.kind === 'edge',
    )
    const approaches = decks.filter(({ deckHeights }) => Math.max(...deckHeights) <= 2)
    const deck = required(decks.find(({ deckHeights }) => Math.min(...deckHeights) === 24))
    expect(approaches.length).toBeGreaterThan(2)

    function recordFills() {
      const fills: Vector2[][] = []
      let points: Vector2[] = []
      const addPoint = (x: number, y: number) => points.push({ x, y })
      return {
        fills,
        graphics: {
          beginPath() { points = [] },
          moveTo: addPoint,
          lineTo: addPoint,
          closePath() {},
          fillPath() { fills.push(points) },
          fillStyle() {},
          lineStyle() {},
          lineBetween() {},
        },
      }
    }
    const upper = recordFills()
    const lower = recordFills()
    renderBridgeDeck(upper.graphics as never, geometry, false, 'terrain', lower.graphics as never)
    for (const approach of approaches) {
      expect(lower.fills).toContainEqual(approach.polygon)
      expect(upper.fills).not.toContainEqual(approach.polygon)
    }
    expect(upper.fills).toContainEqual(deck.polygon)
    expect(lower.fills).not.toContainEqual(deck.polygon)
  })

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
    const pose = required(captureRaceSnapshot({ ...race, vehicles: [car] }).vehicles[0])
    expect(isVehicleAboveStructures(pose, path)).toBe(true)
    expect(isVehicleAboveStructures({
      ...pose, z: 0, structureRunId: null,
    }, path)).toBe(false)

    const graphics = new Graphics()
    renderVehicles(graphics as never, [car], path)
    expect(graphics.bodies).toEqual([{ x: car.x, y: car.y }])
    expect(graphics.scales).toEqual([
      { x: VEHICLE_VISUAL_SCALE, y: VEHICLE_VISUAL_SCALE },
    ])
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
    renderGroundPresentation() {},
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
						x: point.x + (vehicle.player ? 0 : 3),
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
				// The player must be painted after opponents: arcade cars may overlap
				// on a bridge without colliding, but must never hide the player.
				expect(upper.bodies.at(-1)).toEqual({ x: point.x, y: point.y })
				expect(lower.bodies).toHaveLength(0)
				expect(upper.shadows).toHaveLength(4)
				for (const shadow of upper.shadows) {
					expect(Math.hypot(shadow.x - point.x, shadow.y - point.y)).toBeLessThan(6)
				}
			}
			expect(lowRampSamples).toBeGreaterThan(4)
		},
	)

	it('draws only a player outline above a deck that covers a lower car', () => {
		const path = buildRoadPath(track.points, track.terrain)
		const base = createRace({
			path,
			playerCar: 'blue',
			difficulty: 'normal',
			laps: 2,
		})
		const index = path.points.findIndex(
			(_, i) => path.roadSurface.at(i).structureHeight === 24 && path.roadSurface.at(i + 1).structureHeight === 24,
		)
		const point = required(path.points[index])
		const upper = new Graphics()
		const lower = new Graphics()
		let state = {
			...base,
			vehicles: [
				{
					...required(base.vehicles[0]),
					x: (point.x + required(path.points[index + 1]).x) / 2,
					y: point.y,
					pathIndex: index,
					z: 0,
					structureRunId: null,
				},
			],
		}
		const scene = {
    renderGroundPresentation() {},
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
			isCoveredByBridgeDeck: getBridgeDeckOcclusion(buildTrackGeometry(track)),
			raceSession: { advance() {}, snapshot: () => ({ state }) },
		}
		RaceScene.prototype.update.call(scene as never, 0, 16)
		expect(lower.bodies).toHaveLength(1)
		expect(upper.bodies).toHaveLength(0)
		expect(upper.outlines).toEqual(lower.bodies)
		expect(upper.strokes).toBeGreaterThan(0)
		expect(upper.shadows).toHaveLength(0)

		const covered = required(state.vehicles[0])
		state = { ...state, vehicles: [{ ...covered, player: false }] }
		RaceScene.prototype.update.call(scene as never, 0, 16)
		expect(lower.bodies).toHaveLength(1)
		expect(upper.bodies).toHaveLength(0)

		state = { ...state, vehicles: [{ ...covered, y: covered.y + 200 }] }
		RaceScene.prototype.update.call(scene as never, 0, 16)
		expect(lower.bodies).toHaveLength(1)
		expect(upper.bodies).toHaveLength(0)
	})
})
