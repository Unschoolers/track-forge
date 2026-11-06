import type Phaser from 'phaser'
import { CAR_SPECS, WORLD_ELEVATION } from '@/domain/config'
import type { CarId, Vector2 } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'
import type { TerrainSurface } from '@/domain/terrain/terrainSurface'
import { projectSunShadow } from '@/phaser/rendering/lighting'
import type { RoadPath } from '@/domain/track/pathBuilder'
import { getVehicleStepContext } from '@/domain/race/trackContext'

export interface VehicleGeometry {
  readonly id: CarId
  readonly body: readonly Vector2[]
  readonly cabin: readonly Vector2[]
  readonly headlights: readonly [Vector2, Vector2]
  readonly taillights: readonly [Vector2, Vector2]
  readonly wheelbase: number
}

export interface VehicleLightTransform {
  readonly headlights: readonly [Vector2, Vector2]
  readonly taillights: readonly [Vector2, Vector2]
  readonly angle: number
  readonly braking: boolean
  readonly car: CarId
}

export interface VehicleShadow {
  readonly center: Vector2
  readonly angle: number
  readonly width: number
  readonly length: number
  readonly alpha: number
}

const GEOMETRIES: Record<CarId, VehicleGeometry> = {
  blue: {
    id: 'blue',
    body: [
      { x: -17, y: -8 },
      { x: 14, y: -8 },
      { x: 19, y: -5 },
      { x: 19, y: 5 },
      { x: 14, y: 8 },
      { x: -17, y: 8 },
    ],
    cabin: [
      { x: -7, y: -6 },
      { x: 8, y: -6 },
      { x: 10, y: 6 },
      { x: -7, y: 6 },
    ],
    headlights: [{ x: 17, y: -5 }, { x: 17, y: 5 }],
    taillights: [{ x: -16, y: -5 }, { x: -16, y: 5 }],
    wheelbase: 11,
  },
  red: {
    id: 'red',
    body: [
      { x: -19, y: -7 },
      { x: 12, y: -7 },
      { x: 21, y: -4 },
      { x: 21, y: 4 },
      { x: 12, y: 7 },
      { x: -19, y: 7 },
    ],
    cabin: [
      { x: -8, y: -5 },
      { x: 7, y: -5 },
      { x: 11, y: 5 },
      { x: -8, y: 5 },
    ],
    headlights: [{ x: 19.5, y: -5.15 }, { x: 19.5, y: 5.15 }],
    taillights: [{ x: -17.5, y: -5.15 }, { x: -17.5, y: 5.15 }],
    wheelbase: 12,
  },
  green: {
    id: 'green',
    body: [
      { x: -15, y: -9 },
      { x: 13, y: -9 },
      { x: 17, y: -6 },
      { x: 17, y: 6 },
      { x: 13, y: 9 },
      { x: -15, y: 9 },
    ],
    cabin: [
      { x: -6, y: -7 },
      { x: 7, y: -7 },
      { x: 9, y: 7 },
      { x: -6, y: 7 },
    ],
    headlights: [{ x: 15.5, y: -6.55 }, { x: 15.5, y: 6.55 }],
    taillights: [{ x: -15.5, y: -6.55 }, { x: -15.5, y: 6.55 }],
    wheelbase: 10,
  },
  yellow: {
    id: 'yellow',
    body: [
      { x: -20, y: -10 },
      { x: 15, y: -10 },
      { x: 23, y: -7 },
      { x: 23, y: 7 },
      { x: 15, y: 10 },
      { x: -20, y: 10 },
    ],
    cabin: [
      { x: -5, y: -8 },
      { x: 10, y: -8 },
      { x: 12, y: 8 },
      { x: -5, y: 8 },
    ],
    headlights: [{ x: 20.5, y: -7.25 }, { x: 20.5, y: 7.25 }],
    taillights: [{ x: -20.5, y: -7.25 }, { x: -20.5, y: 7.25 }],
    wheelbase: 13,
  },
}

export function getVehicleGeometry(car: CarId): VehicleGeometry {
  return GEOMETRIES[car]
}

/** Supported ramps share the deck's draw layer even near ground level. */
export function isVehicleAboveStructures(vehicle: RaceVehicle, path: RoadPath): boolean {
  const context = getVehicleStepContext(path, vehicle)
  if (context.onRoad && context.structureRunId !== null) return true
  // Preserve elevated/airborne rendering without lifting underpass traffic
  // just because an overhead road has been authored at the same position.
  return vehicle.z - path.terrainSurface.heightAt(vehicle) >=
    WORLD_ELEVATION.levelHeight * 0.45
}

function transform(point: Vector2, pose: Vector2 & { readonly angle: number }): Vector2 {
  const cosine = Math.cos(pose.angle)
  const sine = Math.sin(pose.angle)
  return {
    x: pose.x + point.x * cosine - point.y * sine,
    y: pose.y + point.x * sine + point.y * cosine,
  }
}

export function transformVehicleLights(
  car: CarId,
  pose: Vector2 & { readonly angle: number },
  braking: boolean,
): VehicleLightTransform {
  const geometry = getVehicleGeometry(car)
  return {
    headlights: [
      transform(geometry.headlights[0], pose),
      transform(geometry.headlights[1], pose),
    ],
    taillights: [
      transform(geometry.taillights[0], pose),
      transform(geometry.taillights[1], pose),
    ],
    angle: pose.angle,
    braking,
    car,
  }
}

export function projectVehicleShadow(
  vehicle: RaceVehicle,
  terrainSurface: TerrainSurface,
  night: boolean,
): VehicleShadow | null {
  if (night) return null
  const geometry = getVehicleGeometry(vehicle.car)
  const terrainHeight = terrainSurface.heightAt(vehicle)
  const height = Math.max(
    0,
    (Number.isFinite(vehicle.z) ? vehicle.z : terrainHeight) - terrainHeight,
  )
  const separation = Math.min(1, height / WORLD_ELEVATION.levelHeight)
  return {
    center: projectSunShadow(vehicle, height + 0.8),
    angle: vehicle.angle,
    width: 15 + geometry.wheelbase * 0.24 + separation * 5,
    length: geometry.wheelbase * 2 + 13 + separation * 6,
    alpha: Math.max(0.1, 0.34 - separation * 0.19),
  }
}

function fillPolygon(
  graphics: Phaser.GameObjects.Graphics,
  points: readonly Vector2[],
): void {
  const first = points[0]
  if (!first) return
  graphics.beginPath()
  graphics.moveTo(first.x, first.y)
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]
    if (point) graphics.lineTo(point.x, point.y)
  }
  graphics.closePath()
  graphics.fillPath()
}

function hexColor(value: string): number {
  return Number.parseInt(value.slice(1), 16)
}

export function renderVehicles(
  graphics: Phaser.GameObjects.Graphics,
  vehicles: readonly RaceVehicle[],
): void {
  for (const vehicle of vehicles) {
    const geometry = getVehicleGeometry(vehicle.car)
    graphics.save()
    graphics.translateCanvas(vehicle.x, vehicle.y)
    graphics.rotateCanvas(vehicle.angle)
    graphics.fillStyle(
      hexColor(CAR_SPECS[vehicle.car].color),
      vehicle.wrecked ? 0.55 : 1,
    )
    fillPolygon(graphics, geometry.body)
    graphics.fillStyle(0x18212c, 0.9)
    fillPolygon(graphics, geometry.cabin)
    graphics.fillStyle(0xeaf7ff, 0.95)
    for (const lamp of geometry.headlights) {
      graphics.fillCircle(lamp.x, lamp.y, 1.7)
    }
    graphics.fillStyle(vehicle.braking ? 0xff3038 : 0x5b1620, 1)
    for (const lamp of geometry.taillights) {
      graphics.fillCircle(lamp.x, lamp.y, vehicle.braking ? 2.1 : 1.5)
    }
    graphics.restore()
  }
}

export function renderVehicleShadows(
  graphics: Phaser.GameObjects.Graphics,
  vehicles: readonly RaceVehicle[],
  terrainSurface: TerrainSurface,
  night: boolean,
): void {
  for (const vehicle of vehicles) {
    const shadow = projectVehicleShadow(vehicle, terrainSurface, night)
    if (!shadow) continue
    graphics.save()
    graphics.translateCanvas(shadow.center.x, shadow.center.y)
    graphics.rotateCanvas(shadow.angle)
    graphics.fillStyle(0x020403, shadow.alpha)
    graphics.fillEllipse(0, 0, shadow.length, shadow.width)
    graphics.restore()
  }
}
