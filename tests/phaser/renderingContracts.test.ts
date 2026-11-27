import { describe, expect, it } from 'vitest'
import { CAR_IDS, asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import {
  buildCurbSegments,
  buildStartLineTiles,
} from '@/phaser/rendering/curbRenderer'
import {
  getVehicleGeometry,
  projectVehicleShadow,
  transformVehicleLights,
} from '@/phaser/rendering/vehicleRenderer'
import { createRace } from '@/domain/race/raceFactory'
import {
  EMPTY_TERRAIN,
  paintTerrain,
} from '@/domain/terrain/terrainField'
import { compileTerrainSurface } from '@/domain/terrain/terrainSurface'
import { WORLD_ELEVATION } from '@/domain/config'
import { VEHICLE_VISUAL_SCALE } from '@/presentation/vehicleArtwork'
import {
  projectSunShadowOntoTerrain,
  WORLD_LIGHTING,
} from '@/phaser/rendering/lighting'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { ROAD_BITMAP_DEPTH, ROAD_MARKINGS_DEPTH } from '@/phaser/rendering/meadowBitmapRenderer'
import { renderRoadTransitions, renderRecoveryCheckpoints } from '@/phaser/rendering/trackCues'

describe('race rendering contracts', () => {
  it('keeps terrain, structures, vehicles, lamps, effects, and night ordered', () => {
    const orderedDepths = [
      WORLD_RENDER_DEPTH.terrain,
      WORLD_RENDER_DEPTH.road,
      ROAD_BITMAP_DEPTH,
      ROAD_MARKINGS_DEPTH,
      WORLD_RENDER_DEPTH.environmentScenery,
      WORLD_RENDER_DEPTH.scenery,
      WORLD_RENDER_DEPTH.structureUnderlay,
      WORLD_RENDER_DEPTH.vehicleShadow,
      WORLD_RENDER_DEPTH.lowerVehicle,
      WORLD_RENDER_DEPTH.tallScenery,
      WORLD_RENDER_DEPTH.structureDeck,
      WORLD_RENDER_DEPTH.structureWall,
      WORLD_RENDER_DEPTH.upperVehicle,
      WORLD_RENDER_DEPTH.lamp,
      WORLD_RENDER_DEPTH.effect,
      WORLD_RENDER_DEPTH.nightBeam,
      WORLD_RENDER_DEPTH.nightLight,
    ]

    for (const [index, depth] of orderedDepths.slice(1).entries()) {
      const previousDepth = orderedDepths[index]
      if (previousDepth === undefined) throw new Error('Missing preceding render depth')
      expect(depth).toBeGreaterThan(previousDepth)
    }
    expect(WORLD_RENDER_DEPTH.scenery + 0.01).toBeLessThan(WORLD_RENDER_DEPTH.structureUnderlay)
    expect(WORLD_RENDER_DEPTH.scenery + 0.01).toBeLessThan(WORLD_RENDER_DEPTH.vehicleShadow)
    expect(WORLD_RENDER_DEPTH.tallScenery + 0.01)
      .toBeLessThan(WORLD_RENDER_DEPTH.structureDeck)
  })

  it('defines unique silhouettes and lamp anchors for every car', () => {
    const geometries = CAR_IDS.map((car) => getVehicleGeometry(car))
    expect(new Set(geometries.map(({ id }) => id)).size).toBe(4)
    expect(
      new Set(geometries.map(({ body }) => JSON.stringify(body))).size,
    ).toBe(4)
    expect(geometries.every(({ headlights, taillights }) =>
      headlights.length === 2 && taillights.length === 2,
    )).toBe(true)
  })

  it('rotates exact light anchors with the vehicle transform', () => {
    const transformed = transformVehicleLights(
      'red',
      { x: 100, y: 50, angle: Math.PI / 2 },
      true,
    )
    const geometry = getVehicleGeometry('red')

    expect(transformed.headlights[0]?.x).toBeCloseTo(
      100 - (geometry.headlights[0]?.y ?? 0) * VEHICLE_VISUAL_SCALE,
    )
    expect(transformed.headlights[0]?.y).toBeCloseTo(
      50 + (geometry.headlights[0]?.x ?? 0) * VEHICLE_VISUAL_SCALE,
    )
    expect(transformed.braking).toBe(true)
  })

  it('retains start-line and street-curb presentation contracts', () => {
    const track = createStarterTrack(asTrackId('rendering'), 1)
    const path = buildRoadPath(track.points, track.terrain)
    expect(buildStartLineTiles(path)).toHaveLength(8)
    expect(buildCurbSegments(path).length).toBeGreaterThan(4)
  })

  it('marks grip and overpass transitions in the road ribbon at day and night', () => {
    const track = createStarterTrack(asTrackId('road-cues'), 1)
    const points = track.points.map((point, index) => index === 4
      ? { ...point, surface: 'dirt' as const }
      : index === 8 || index === 9
        ? { ...point, structure: 'overpass' as const }
        : point)
    const path = buildRoadPath(points, track.terrain)
    const colors: number[] = []
    const lines: number[] = []
    const graphics = {
      lineStyle: (_width: number, color: number) => { colors.push(color) },
      lineBetween: () => { lines.push(1) },
      fillStyle: () => undefined,
      fillCircle: () => undefined,
    }
    renderRoadTransitions(graphics as never, path, false)
    const dayCount = lines.length
    renderRoadTransitions(graphics as never, path, true)

    expect(dayCount).toBeGreaterThan(3)
    expect(lines.length).toBeGreaterThan(dayCount)
    expect(new Set(colors).size).toBeGreaterThan(1)
  })

  it('emphasizes only the active authoritative timing gate', () => {
    const track = createStarterTrack(asTrackId('next-gate-cue'), 1)
    const path = buildRoadPath(track.points, track.terrain)
    const widths: number[] = []
    const graphics = {
      lineStyle: (width: number) => { widths.push(width) },
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      strokePath: () => undefined,
      fillStyle: () => undefined,
      fillCircle: () => undefined,
    }
    const checkpoints = [4, 12]
    renderRecoveryCheckpoints(graphics as never, path, checkpoints, undefined, 12)

    expect(widths).toEqual([5, 11])
  })

  it('separates and softens a vehicle shadow as physical height increases', () => {
    const track = createStarterTrack(asTrackId('shadow'), 1)
    const path = buildRoadPath(track.points, track.terrain)
    const vehicle = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    }).vehicles[0]
    if (!vehicle) throw new Error('Missing vehicle fixture')

    const terrainSurface = path.terrainSurface
    const ground = projectVehicleShadow(
      { ...vehicle, z: 0 },
      terrainSurface,
      false,
    )
    const bridge = projectVehicleShadow(
      { ...vehicle, z: 10 },
      terrainSurface,
      false,
    )
    const airborne = projectVehicleShadow(
      { ...vehicle, z: 18 },
      terrainSurface,
      false,
    )
    if (!ground || !bridge || !airborne) {
      throw new Error('Expected day shadows')
    }
    const distance = (shadow: typeof ground) =>
      Math.hypot(
        shadow.center.x - vehicle.x,
        shadow.center.y - vehicle.y,
      )

    expect(distance(bridge)).toBeGreaterThan(distance(ground))
    expect(distance(airborne)).toBeGreaterThan(distance(bridge))
    expect(airborne.alpha).toBeLessThan(ground.alpha)
    expect(airborne.width).toBeGreaterThan(ground.width)
    expect(ground.width).toBeCloseTo((15 + getVehicleGeometry('blue').wheelbase * 0.24) * VEHICLE_VISUAL_SCALE)
    expect(projectVehicleShadow(vehicle, terrainSurface, true)).toBeNull()
  })

  it('projects hill shadows from clearance above the local terrain', () => {
    const track = createStarterTrack(asTrackId('hill-shadow'), 1)
    const path = buildRoadPath(track.points, track.terrain)
    const vehicle = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    }).vehicles[0]
    if (!vehicle) throw new Error('Missing vehicle fixture')

    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      Array.from({ length: 100 }, (_, index) => ({
        column: index % 10,
        row: Math.floor(index / 10),
      })),
      'hill',
    )
    const terrainSurface = compileTerrainSurface(terrain, [])
    const position = { x: 160, y: 160 }
    const grounded = projectVehicleShadow(
      { ...vehicle, ...position, z: 24 },
      terrainSurface,
      false,
    )
    const overpass = projectVehicleShadow(
      { ...vehicle, ...position, z: 48 },
      terrainSurface,
      false,
    )
    const airborne = projectVehicleShadow(
      { ...vehicle, ...position, z: 60 },
      terrainSurface,
      false,
    )
    if (!grounded || !overpass || !airborne) {
      throw new Error('Expected day shadows')
    }
    const distance = (shadow: typeof grounded) =>
      Math.hypot(shadow.center.x - position.x, shadow.center.y - position.y)

    expect(distance(grounded)).toBeLessThan(2)
    expect(distance(overpass)).toBeGreaterThan(distance(grounded) + 20)
    expect(distance(airborne)).toBeGreaterThan(distance(overpass))
  })

  it('projects absolute structure height onto the local receiving terrain', () => {
    const terrain = paintTerrain(
      EMPTY_TERRAIN,
      Array.from({ length: 100 }, (_, index) => ({
        column: index % 10,
        row: Math.floor(index / 10),
      })),
      'hill',
    )
    const terrainSurface = compileTerrainSurface(terrain, [])
    const position = { x: 160, y: 160 }
    const projection = projectSunShadowOntoTerrain(
      position,
      WORLD_ELEVATION.levelHeight * 2,
      terrainSurface,
    )

    expect(projection.terrainHeight).toBe(WORLD_ELEVATION.levelHeight)
    expect(projection.clearance).toBeCloseTo(
      WORLD_ELEVATION.levelHeight,
      5,
    )
    expect(
      Math.hypot(
        projection.point.x - position.x,
        projection.point.y - position.y,
      ),
    ).toBeCloseTo(
      WORLD_ELEVATION.levelHeight *
        WORLD_LIGHTING.shadowLengthPerHeight *
        Math.hypot(
          WORLD_LIGHTING.sunShadowDirection.x,
          WORLD_LIGHTING.sunShadowDirection.y,
        ),
      3,
    )
  })
})
