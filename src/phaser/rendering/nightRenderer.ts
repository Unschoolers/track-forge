import type Phaser from 'phaser'
import type { WorldBounds } from '@/presentation/environments/groundTexture'
import type { VehicleLightTransform } from '@/phaser/rendering/vehicleRenderer'
import { buildLampLights, type LampPost } from '@/phaser/rendering/lampPostRenderer'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { getNightHeadlightBeam, NIGHT_HEADLIGHT } from '@/presentation/nightLighting'

const NIGHT_BEAM_KEY = 'trackforge-headlight-beam-v2'

/**
 * One cached, soft beam texture per visible vehicle. The texture is shared with
 * the pre-race flyover; moving an image is cheaper than submitting translucent
 * overlapping triangles every frame.
 */
export class NightBeamRenderer {
  private readonly beams: Phaser.GameObjects.Image[] = []

  constructor(private readonly scene: Phaser.Scene, private readonly beamBlendMode: number) {}

  render(vehicles: readonly VehicleLightTransform[]): void {
    if (vehicles.length > 0 && !this.scene.textures.exists(NIGHT_BEAM_KEY)) {
      this.scene.textures.addCanvas(NIGHT_BEAM_KEY, getNightHeadlightBeam())
    }

    vehicles.forEach((vehicle, index) => {
      let beam = this.beams[index]
      if (!beam) {
        beam = this.scene.add.image(0, 0, NIGHT_BEAM_KEY)
          .setOrigin(0, 0.5)
          .setDepth(WORLD_RENDER_DEPTH.nightBeam)
          .setBlendMode(this.beamBlendMode)
        this.beams.push(beam)
      }
      const frontX = (vehicle.headlights[0].x + vehicle.headlights[1].x) / 2
      const frontY = (vehicle.headlights[0].y + vehicle.headlights[1].y) / 2
      beam.setPosition(
        frontX - Math.cos(vehicle.angle) * NIGHT_HEADLIGHT.sourceX,
        frontY - Math.sin(vehicle.angle) * NIGHT_HEADLIGHT.sourceX,
      )
      beam.setRotation(vehicle.angle)
      beam.setVisible(true)
    })

    for (let index = vehicles.length; index < this.beams.length; index++) {
      this.beams[index]?.setVisible(false)
    }
  }

  destroy(): void {
    for (const beam of this.beams) beam.destroy()
    this.beams.length = 0
  }
}

/** Small fixture glows and brake lights, without a second beam geometry pass. */
export function renderNightLights(
  graphics: Phaser.GameObjects.Graphics,
  lights: readonly VehicleLightTransform[],
  lamps: readonly LampPost[],
  visibleBounds?: WorldBounds,
): void {
  for (const lamp of buildLampLights(lamps)) {
    if (visibleBounds &&
        (lamp.center.x + lamp.radius < visibleBounds.left ||
          lamp.center.x - lamp.radius > visibleBounds.right ||
          lamp.center.y + lamp.radius < visibleBounds.top ||
          lamp.center.y - lamp.radius > visibleBounds.bottom)) continue
    graphics.fillStyle(0xffd88a, lamp.intensity * 0.14)
    graphics.fillCircle(lamp.center.x, lamp.center.y, lamp.radius)
    graphics.fillStyle(0xffdf98, lamp.intensity * 0.3)
    graphics.fillCircle(lamp.center.x, lamp.center.y, lamp.radius * 0.68)
    graphics.fillStyle(0xffe7ae, lamp.intensity * 0.52)
    graphics.fillCircle(lamp.center.x, lamp.center.y, lamp.radius * 0.38)
    graphics.fillStyle(0xffe4a3, lamp.intensity * 1.35)
    graphics.fillCircle(lamp.fixture.x, lamp.fixture.y, 6)
    graphics.fillStyle(0xfff0bf, lamp.intensity * 1.9)
    graphics.fillCircle(lamp.fixture.x, lamp.fixture.y, 2.8)
  }

  for (const vehicle of lights) {
    for (const headlight of vehicle.headlights) {
      graphics.fillStyle(0xfff2b2, 0.22)
      graphics.fillCircle(headlight.x, headlight.y, 4)
    }
    for (const taillight of vehicle.taillights) {
      graphics.fillStyle(0xff2438, vehicle.braking ? 0.42 : 0.2)
      graphics.fillCircle(taillight.x, taillight.y, vehicle.braking ? 9 : 5)
    }
  }
}
