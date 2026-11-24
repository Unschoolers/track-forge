import type Phaser from 'phaser'
import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import type { CarId, Vector2 } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'
import type { TerrainSurface } from '@/domain/terrain/terrainSurface'
import { projectSunShadow } from '@/phaser/rendering/lighting'
import type { RoadPath } from '@/domain/track/pathBuilder'
import { getVehicleStepContext } from '@/domain/race/trackContext'
import type { GhostPose } from '@/application/race/ghostReplay'
import { DEFAULT_PLAYER_IDENTITY, TOPPER_COLORS, type PlayerIdentity } from '@/application/multiplayer/playerIdentity'
import { getVehicleArtwork, vehiclePaintColor, VEHICLE_VISUAL_SCALE, type VehicleArtwork } from '@/presentation/vehicleArtwork'

export type VehicleGeometry = VehicleArtwork

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

type VehicleShadowPose = Pick<RaceVehicle, 'car' | 'x' | 'y' | 'z' | 'angle'>

export function getVehicleGeometry(car: CarId): VehicleGeometry {
  return getVehicleArtwork(car)
}

/** Supported ramps share the deck's draw layer even near ground level. */
export function isVehicleAboveStructures(
  vehicle: Pick<RaceVehicle, 'x' | 'y' | 'z' | 'player' | 'grounded' | 'pathIndex' | 'structureRunId'>,
  path: RoadPath,
): boolean {
  // A car can briefly be matched to the underpass at a 2D crossing even
  // while its last supported road sample is on the ramp. Trust that authored
  // support only while the car is physically near its sample and at deck height.
  const supported = path.points[vehicle.pathIndex]
  if (supported && vehicle.structureRunId !== null) {
    const support = path.roadSurface.at(vehicle.pathIndex, vehicle)
    if (
      support.structureRunId === vehicle.structureRunId &&
      support.structureHeight > 0.005 &&
      Math.hypot(vehicle.x - supported.x, vehicle.y - supported.y) <=
        ROAD_GEOMETRY.onRoadRadius &&
      vehicle.z >= support.height - 2
    ) return true
  }
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
    x: pose.x + (point.x * cosine - point.y * sine) * VEHICLE_VISUAL_SCALE,
    y: pose.y + (point.x * sine + point.y * cosine) * VEHICLE_VISUAL_SCALE,
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
  vehicle: VehicleShadowPose,
  terrainSurface: TerrainSurface,
  night: boolean,
  receiverHeight?: number,
): VehicleShadow | null {
  if (night) return null
  const geometry = getVehicleGeometry(vehicle.car)
  const surfaceHeight = receiverHeight ?? terrainSurface.heightAt(vehicle)
  const height = Math.max(
    0,
    (Number.isFinite(vehicle.z) ? vehicle.z : surfaceHeight) - surfaceHeight,
  )
  const separation = Math.min(1, height / WORLD_ELEVATION.levelHeight)
  return {
    center: projectSunShadow(vehicle, height + 0.8),
    angle: vehicle.angle,
    width: (15 + geometry.wheelbase * 0.24 + separation * 5) * VEHICLE_VISUAL_SCALE,
    length: (geometry.wheelbase * 2 + 13 + separation * 6) * VEHICLE_VISUAL_SCALE,
    alpha: Math.max(0.1, 0.34 - separation * 0.19),
  }
}

function tracePolygon(
  graphics: Phaser.GameObjects.Graphics,
  points: readonly Vector2[],
  offsetX = 0,
): void {
  const first = points[0]
  if (!first) return
  graphics.beginPath()
  graphics.moveTo(first.x + offsetX, first.y)
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]
    if (point) graphics.lineTo(point.x + offsetX, point.y)
  }
  graphics.closePath()
}

function fillPolygon(
  graphics: Phaser.GameObjects.Graphics,
  points: readonly Vector2[],
  offsetX = 0,
): void {
  tracePolygon(graphics, points, offsetX)
  graphics.fillPath()
}

/** Draw the shared vector layers, including windows, fenders and pickup bed. */
function drawVehicleBody(
  graphics: Phaser.GameObjects.Graphics,
  car: CarId,
  braking: boolean,
  alpha = 1,
): void {
  const artwork = getVehicleArtwork(car)
  for (const layer of artwork.layers) {
    graphics.fillStyle(vehiclePaintColor(car, layer.tone), (layer.alpha ?? 1) * alpha)
    fillPolygon(graphics, layer.points)
    if (layer.outline) {
      graphics.lineStyle(1.4, 0x101923, alpha)
      graphics.strokePath()
    }
  }
  graphics.fillStyle(0xeaf7ff, 0.95 * alpha)
  for (const lamp of artwork.headlights) graphics.fillCircle(lamp.x, lamp.y, 1.7)
  graphics.fillStyle(braking ? 0xff3038 : 0x5b1620, alpha)
  for (const lamp of artwork.taillights) graphics.fillCircle(lamp.x, lamp.y, braking ? 2.1 : 1.5)
}

export function renderVehicles(
  graphics: Phaser.GameObjects.Graphics,
  vehicles: readonly RaceVehicle[],
  path: RoadPath,
): void {
  for (const vehicle of vehicles) {
    const compression = Math.max(0, vehicle.suspensionCompression)
    const impact = vehicle.landingIntensity
    const clearance = vehicle.grounded ? 0 : Math.max(
      0, vehicle.z - path.roadSurface.at(vehicle.pathIndex, vehicle).height,
    )
    // From above, pitch shortens the silhouette and shifts the roof toward
    // the raised axle. A falling car visibly noses down before touchdown.
    const pitch = vehicle.grounded ? -impact : Math.max(-1, Math.min(1, vehicle.verticalVelocity / 35))
    const lift = Math.min(0.11, clearance * 0.012)
    graphics.save()
    graphics.translateCanvas(vehicle.x, vehicle.y)
    graphics.rotateCanvas(vehicle.angle)
    graphics.scaleCanvas(
      (1 + lift - 0.12 * Math.abs(pitch)) * VEHICLE_VISUAL_SCALE,
      (1 + lift + 0.1 * Math.max(impact * 0.55, compression)) * VEHICLE_VISUAL_SCALE,
    )
    drawVehicleBody(graphics, vehicle.car, vehicle.braking, 1)
    graphics.restore()
  }
}

/** Transparent reference lap. A ghost never enters physics or collisions. */
export function renderGhostVehicle(
  graphics: Phaser.GameObjects.Graphics,
  ghost: GhostPose,
): void {
  const geometry = getVehicleGeometry(ghost.car)
  graphics.save()
  graphics.translateCanvas(ghost.x, ghost.y)
  graphics.rotateCanvas(ghost.angle)
  graphics.scaleCanvas(VEHICLE_VISUAL_SCALE, VEHICLE_VISUAL_SCALE)
  graphics.fillStyle(0x99ecff, 0.28)
  fillPolygon(graphics, geometry.body)
  graphics.fillStyle(0xe8fbff, 0.16)
  fillPolygon(graphics, geometry.cabin)
  graphics.restore()
}

/** Render a human opponent as a solid car. Nearby racing is non-colliding, not translucent. */
export function renderNearbyVehicle(
  graphics: Phaser.GameObjects.Graphics,
  pose: GhostPose,
): void {
  graphics.save()
  graphics.translateCanvas(pose.x, pose.y)
  graphics.rotateCanvas(pose.angle)
  graphics.scaleCanvas(VEHICLE_VISUAL_SCALE, VEHICLE_VISUAL_SCALE)
  graphics.fillStyle(0x050b11, 0.2)
  graphics.fillEllipse(2, 3, 34, 17)
  drawVehicleBody(graphics, pose.car, false)
  drawTopper(graphics, pose.identity ?? DEFAULT_PLAYER_IDENTITY)
  graphics.restore()
}

/** Draw above the roof in car-local coordinates; no physics or network updates. */
function drawTopper(graphics: Phaser.GameObjects.Graphics, identity: PlayerIdentity): void {
  graphics.lineStyle(2, 0x121923, 0.95)
  graphics.beginPath()
  graphics.moveTo(-3, -1)
  graphics.lineTo(-3, -14)
  graphics.strokePath()
  graphics.translateCanvas(-3, -15)
  graphics.fillStyle(0x101821, 1)
  graphics.fillCircle(0, 0, 7)
  graphics.fillStyle(TOPPER_COLORS[identity.color], 1)
  switch (identity.icon) {
    case 'star': {
      const points = Array.from({ length: 10 }, (_, index) => {
        const angle = index * Math.PI / 5 - Math.PI / 2
        const radius = index % 2 ? 2.7 : 6
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
      })
      fillPolygon(graphics, points)
      break
    }
    case 'flag':
      fillPolygon(graphics, [{ x: -4, y: -5 }, { x: 5, y: -3 }, { x: -4, y: 1 }])
      graphics.fillRect(-4, -5, 1.5, 11)
      break
    case 'bolt':
      fillPolygon(graphics, [{ x: 0, y: -6 }, { x: -4, y: 0 }, { x: -1, y: 0 },
        { x: -3, y: 6 }, { x: 5, y: -1 }, { x: 1, y: -1 }, { x: 4, y: -6 }])
      break
    case 'crown':
      fillPolygon(graphics, [{ x: -5, y: -3 }, { x: -3, y: 1 }, { x: 0, y: -5 },
        { x: 3, y: 1 }, { x: 5, y: -3 }, { x: 4, y: 5 }, { x: -4, y: 5 }])
      break
    case 'diamond':
      fillPolygon(graphics, [{ x: 0, y: -6 }, { x: 6, y: 0 }, { x: 0, y: 6 }, { x: -6, y: 0 }])
      break
    case 'ball':
      graphics.fillCircle(0, 0, 5)
      break
  }
}

export function renderPlayerTopper(
  graphics: Phaser.GameObjects.Graphics,
  pose: Pick<RaceVehicle, 'x' | 'y' | 'angle'>,
  identity: PlayerIdentity = DEFAULT_PLAYER_IDENTITY,
): void {
  graphics.save()
  graphics.translateCanvas(pose.x, pose.y)
  graphics.rotateCanvas(pose.angle)
  graphics.scaleCanvas(VEHICLE_VISUAL_SCALE, VEHICLE_VISUAL_SCALE)
  drawTopper(graphics, identity)
  graphics.restore()
}

/** Keep the player readable through an overhead deck without moving the car body. */
export function renderCoveredPlayerOutline(
  graphics: Phaser.GameObjects.Graphics,
  player: Pick<RaceVehicle, 'car' | 'x' | 'y' | 'angle'>,
): void {
  graphics.save()
  graphics.translateCanvas(player.x, player.y)
  graphics.rotateCanvas(player.angle)
  graphics.scaleCanvas(VEHICLE_VISUAL_SCALE, VEHICLE_VISUAL_SCALE)
  tracePolygon(graphics, getVehicleGeometry(player.car).body)
  graphics.lineStyle(4, 0x101820, 0.85)
  graphics.strokePath()
  graphics.lineStyle(2, 0xf4faff, 0.95)
  graphics.strokePath()
  graphics.restore()
}

export function renderVehicleShadows(
  groundGraphics: Phaser.GameObjects.Graphics,
  bridgeGraphics: Phaser.GameObjects.Graphics,
  vehicles: readonly RaceVehicle[],
  path: RoadPath,
  night: boolean,
): void {
  if (night) return
  for (const vehicle of vehicles) {
    const support = vehicle.structureRunId === null
      ? undefined
      : path.roadSurface.at(vehicle.pathIndex, vehicle)
    const bridgeHeight = support?.structureRunId === vehicle.structureRunId &&
      vehicle.z >= support.height - 2
      ? support.height
      : undefined
    const shadow = projectVehicleShadow(vehicle, path.terrainSurface, false, bridgeHeight)
    if (!shadow) continue
    const graphics = bridgeHeight === undefined ? groundGraphics : bridgeGraphics
    graphics.save()
    graphics.translateCanvas(shadow.center.x, shadow.center.y)
    graphics.rotateCanvas(shadow.angle)
    graphics.fillStyle(0x020403, shadow.alpha)
    graphics.fillEllipse(0, 0, shadow.length, shadow.width)
    graphics.restore()
  }
}
