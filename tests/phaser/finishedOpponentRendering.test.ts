import { expect, it, vi } from 'vitest'
import { asTrackId } from '@/domain/model'
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

// The real scene and renderers draw into this recording graphics surface.
class RecordingGraphics {
  positions: { x: number; y: number }[] = []
  lightOrigins: { x: number; y: number }[] = []
  lightCircles: { x: number; y: number; radius: number }[] = []

  clear() {
    this.positions = []
    this.lightOrigins = []
    this.lightCircles = []
  }
  translateCanvas(x: number, y: number) {
    this.positions.push({ x, y })
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
  fillStyle() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  fillPath() {}
  fillEllipse() {}
  fillRect() {}
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
  const scene = {
    vehicleGraphics,
    upperVehicleGraphics,
    shadowGraphics,
    nightLightGraphics,
    nightShadeGraphics: new RecordingGraphics(),
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
    { x: 100, y: 100 },
    { x: 200, y: 100 },
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

it('clears finished opponent headlights and taillights while retaining active and player lights', () => {
  const scene = createRenderingScenario()
  scene.setNight()
  scene.draw()
  expect(scene.nightLightGraphics.lightOrigins).toHaveLength(16)

  scene.finishOpponents()
  scene.draw()
  const vehicles = scene.state().vehicles
  const player = vehicles[0]
  const active = vehicles[2]
  if (!player || !active) throw new Error('Missing race fixtures')
  const expectedLights = [player, active].flatMap((vehicle) =>
    transformVehicleLights(
      vehicle.car,
      vehicle,
      vehicle.braking,
    ).headlights.flatMap((light) => [light, light]),
  )
  const expectedTaillights = [player, active].flatMap((vehicle) =>
    transformVehicleLights(
      vehicle.car,
      vehicle,
      vehicle.braking,
    ).taillights.map((light) => ({
      ...light,
      radius: vehicle.braking ? 9 : 5,
    })),
  )
  expect(scene.nightLightGraphics.lightOrigins).toEqual(expectedLights)
  expect(
    scene.nightLightGraphics.lightCircles.filter(
      ({ radius }) => radius !== 5.5,
    ),
  ).toEqual(expectedTaillights)

  scene.finishPlayer()
  scene.draw()
  expect(scene.nightLightGraphics.lightOrigins).toEqual(expectedLights)
  expect(
    scene.nightLightGraphics.lightCircles.filter(
      ({ radius }) => radius !== 5.5,
    ),
  ).toEqual(expectedTaillights)
})
