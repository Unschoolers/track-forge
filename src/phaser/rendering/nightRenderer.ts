import type Phaser from 'phaser'
import type { Vector2 } from '@/domain/model'
import type { VehicleLightTransform } from '@/phaser/rendering/vehicleRenderer'
import {
  buildLampLights,
  type LampPost,
} from '@/phaser/rendering/lampPostRenderer'

export interface NightViewport {
  readonly width: number
  readonly height: number
  readonly cameraCenter: Vector2
  readonly cameraZoom: number
}

export function renderNightShade(
  graphics: Phaser.GameObjects.Graphics,
  viewport: NightViewport,
): void {
  // This pass lives in world space like the track and vehicles. Cover the
  // viewport's full diagonal so camera rotation can never expose a square edge.
  const radius =
    Math.hypot(viewport.width, viewport.height) /
    Math.max(0.01, viewport.cameraZoom)
  graphics.fillStyle(0x02050a, 0.66)
  graphics.fillRect(
    viewport.cameraCenter.x - radius,
    viewport.cameraCenter.y - radius,
    radius * 2,
    radius * 2,
  )
}

export function renderNightLights(
  graphics: Phaser.GameObjects.Graphics,
  lights: readonly VehicleLightTransform[],
  lamps: readonly LampPost[],
): void {
  for (const lamp of buildLampLights(lamps)) {
    graphics.fillStyle(0xffd88a, lamp.intensity * 0.14)
    graphics.fillCircle(
      lamp.center.x,
      lamp.center.y,
      lamp.radius,
    )
    graphics.fillStyle(0xffdf98, lamp.intensity * 0.3)
    graphics.fillCircle(
      lamp.center.x,
      lamp.center.y,
      lamp.radius * 0.68,
    )
    graphics.fillStyle(0xffe7ae, lamp.intensity * 0.52)
    graphics.fillCircle(
      lamp.center.x,
      lamp.center.y,
      lamp.radius * 0.38,
    )
    graphics.fillStyle(0xffe4a3, lamp.intensity * 1.35)
    graphics.fillCircle(lamp.fixture.x, lamp.fixture.y, 6)
    graphics.fillStyle(0xfff0bf, lamp.intensity * 1.9)
    graphics.fillCircle(lamp.fixture.x, lamp.fixture.y, 2.8)
  }
  for (const vehicle of lights) {
    const cosine = Math.cos(vehicle.angle)
    const sine = Math.sin(vehicle.angle)
    for (const headlight of vehicle.headlights) {
      const length = vehicle.car === 'red' ? 148 : 138
      const end = {
        x: headlight.x + cosine * length,
        y: headlight.y + sine * length,
      }
      const spread = 29
      graphics.fillStyle(0xfff3c4, 0.025)
      graphics.fillTriangle(
        headlight.x,
        headlight.y,
        end.x - sine * spread,
        end.y + cosine * spread,
        end.x + sine * spread,
        end.y - cosine * spread,
      )
      const innerLength = length * 0.72
      const innerEnd = {
        x: headlight.x + cosine * innerLength,
        y: headlight.y + sine * innerLength,
      }
      const innerSpread = 14
      graphics.fillStyle(0xfff0b8, 0.048)
      graphics.fillTriangle(
        headlight.x,
        headlight.y,
        innerEnd.x - sine * innerSpread,
        innerEnd.y + cosine * innerSpread,
        innerEnd.x + sine * innerSpread,
        innerEnd.y - cosine * innerSpread,
      )
      graphics.fillStyle(0xfff2b2, 0.16)
      graphics.fillCircle(headlight.x, headlight.y, 5.5)
    }
    for (const taillight of vehicle.taillights) {
      graphics.fillStyle(0xff2438, vehicle.braking ? 0.42 : 0.2)
      graphics.fillCircle(taillight.x, taillight.y, vehicle.braking ? 9 : 5)
    }
  }
}
