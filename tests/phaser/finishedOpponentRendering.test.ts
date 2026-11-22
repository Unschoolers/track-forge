import { expect, it, vi } from 'vitest'
import { CAR_IDS, asTrackId } from '@/domain/model'
import { vehiclePaintColor } from '@/presentation/vehicleArtwork'
import { createRace } from '@/domain/race/raceFactory'
import type { RaceState } from '@/domain/race/raceState'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { createStarterTrack } from '@/domain/track/starterTrack'
import {
  projectVehicleShadow,
  transformVehicleLights,
} from '@/phaser/rendering/vehicleRenderer'

vi.mock('phaser', () => ({ default: { Scene: class {} } }))
import { RaceScene } from '@/phaser/scenes/RaceScene'

// Only a main body paint pass represents a car; toppers also use scaling transforms.
const BODY_PAINT_COLORS = new Set(CAR_IDS.map(car => vehiclePaintColor(car, 'body')))

// The real scene and renderers draw into this recording graphics surface.
class RecordingGraphics {
  positions: { x: number; y: number }[] = []
  lightOrigins: { x: number; y: number }[] = []
  lightCircles: { x: number; y: number; radius: number }[] = []
  private translated = { x: 0, y: 0 }

  clear() {
    this.positions = []
    this.lightOrigins = []
    this.lightCircles = []
  }
  translateCanvas(x: number, y: number) {
    this.translated = { x, y }
  }
  fillTriangle(x: number, y: number) {
    this.lightOrigins.push({ x, y })
  }
  fillCircle(x: number, y: number, radius: number) {
    this.lightCircles.push({ x, y, radius })
  }
  save() {}
  restore() {}
  rotateCanvas() {}
  // A cosmetic topper transform must not count as another vehicle silhouette.
  scaleCanvas() {}
  fillStyle(color: number) {
    if (BODY_PAINT_COLORS.has(color)) this.positions.push({ ...this.translated })
  }
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  fillPath() {}
  fillEllipse() { this.positions.push({ ...this.translated }) }
  fillRect() {}
  lineStyle() {}
  strokePath() {}
}

function createRenderingScenario() {
  const track = createStarterTrack(asTrackId('finished-rendering'), 1)
  const path = buildRoadPath(track.points, track.terrain)
  const race = createRace({
    path,
    playerCar: 'blue',
    difficulty: 'normal',
    laps: 3,
  })
  let state: RaceState = {
    ...race,
    phase: 'running',
    vehicles: race.vehicles.map((vehicle, index) => ({
      ...vehicle,
      x: 100 + index * 100,
      y: 100,
      z: index >= 2 ? 48 : 0,
      angle: 0,
    })),
  }
  let lighting: 'day' | 'night' = 'day'
  const vehicleGraphics = new RecordingGraphics()
  const upperVehicleGraphics = new RecordingGraphics()
  const shadowGraphics = new RecordingGraphics()
  const nightLightGraphics = new RecordingGraphics()
  const beamRenderer = { render: vi.fn() }
  const scene = {
    renderGroundPresentation() {},
    vehicleGraphics,
    upperVehicleGraphics,
    shadowGraphics,
    nightLightGraphics,
    nightBeamRenderer: beamRenderer,
    effectGraphics: new RecordingGraphics(),
    snapshot: {},
    controller: { snapshot: () => ({ preferences: { lighting } }) },
    raceSession: { advance() {}, snapshot: () => ({ state, setup: { lighting } }) },
    controls: {
      snapshot: () => ({ steering: 0, throttle: 1, braking: false }),
    },
    game: { loop: { rawDelta: 16 } },
    scale: { width: 800, height: 600 },
    lamps: [],
  }
  return {
    path,
    vehicleGraphics,
    upperVehicleGraphics,
    shadowGraphics,
    nightLightGraphics,
    beamRenderer,
    state: () => state,
    draw: () => RaceScene.prototype.update.call(scene as never, 0, 16),
    setNight: () => {
      lighting = 'night'
    },
    finishOpponents: () => {
      state = {
        ...state,
        vehicles: state.vehicles.map((vehicle, index) =>
          index === 1 || index === 3 ? { ...vehicle, finishedAt: 0 } : vehicle,
        ),
      }
    },
    finishPlayer: () => {
      state = {
        ...state,
        phase: 'finished',
        vehicles: state.vehicles.map((vehicle) =>
          vehicle.player ? { ...vehicle, finishedAt: 23 } : vehicle,
        ),
      }
    },
  }
}

it('removes finished opponent bodies from both height layers while retaining the player', () => {
  const scene = createRenderingScenario()
  scene.draw()
  expect(scene.vehicleGraphics.positions).toEqual([
    { x: 200, y: 100 },
    { x: 100, y: 100 },
  ])
  expect(scene.upperVehicleGraphics.positions).toEqual([
    { x: 300, y: 100 },
    { x: 400, y: 100 },
  ])

  scene.finishOpponents()
  scene.draw()
  expect(scene.vehicleGraphics.positions).toEqual([{ x: 100, y: 100 }])
  expect(scene.upperVehicleGraphics.positions).toEqual([{ x: 300, y: 100 }])
  expect(scene.state().vehicles).toHaveLength(4)

  scene.finishPlayer()
  scene.draw()
  expect(scene.vehicleGraphics.positions).toEqual([{ x: 100, y: 100 }])
})

it('clears shadows of finished opponents while retaining active shadows', () => {
  const scene = createRenderingScenario()
  scene.draw()
  expect(scene.shadowGraphics.positions).toHaveLength(4)

  scene.finishOpponents()
  scene.draw()
  const vehicles = scene.state().vehicles
  const player = vehicles[0]
  const active = vehicles[2]
  if (!player || !active) throw new Error('Missing race fixtures')
  expect(scene.shadowGraphics.positions).toEqual([
    projectVehicleShadow(player, scene.path.terrainSurface, false)?.center,
    projectVehicleShadow(active, scene.path.terrainSurface, false)?.center,
  ])
})

it('removes finished rivals from both the beam pass and fixture pass', () => {
  const scene = createRenderingScenario()
  scene.setNight()
  scene.draw()
  expect(scene.beamRenderer.render).toHaveBeenLastCalledWith(
    scene.state().vehicles.map((v) => transformVehicleLights(v.car, v, v.braking)),
  )
  expect(scene.nightLightGraphics.lightCircles).toHaveLength(16)

  scene.finishOpponents()
  scene.draw()
  const vehicles = scene.state().vehicles
  const player = vehicles[0]
  const active = vehicles[2]
  if (!player || !active) throw new Error('Missing race fixtures')
  const expectedLights = [player, active].map((v) =>
    transformVehicleLights(v.car, v, v.braking),
  )
  const expectedFixtures = expectedLights.flatMap((lights) => [
    ...lights.headlights.map((light) => ({ ...light, radius: 3.2 })),
    ...lights.taillights.map((light) => ({
      ...light,
      radius: lights.braking ? 9 : 5,
    })),
  ])
  expect(scene.beamRenderer.render).toHaveBeenLastCalledWith(expectedLights)
  expect(scene.nightLightGraphics.lightOrigins).toEqual([])
  expect(scene.nightLightGraphics.lightCircles).toEqual(expectedFixtures)

  // The player's car remains drawn on the medal screen after finishing.
  scene.finishPlayer()
  scene.draw()
  expect(scene.beamRenderer.render).toHaveBeenLastCalledWith(expectedLights)
  expect(scene.nightLightGraphics.lightCircles).toEqual(expectedFixtures)
})
