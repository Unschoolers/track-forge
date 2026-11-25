import type Phaser from 'phaser'
import type { WorldBounds } from '@/presentation/environments/groundTexture'
import type { VehicleLightTransform } from '@/phaser/rendering/vehicleRenderer'
import { buildLampLights, type LampLight, type LampPost } from '@/phaser/rendering/lampPostRenderer'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { chunkSpatialItems } from '@/phaser/rendering/raceTerrainChunks'
import { getNightHeadlightBeam, NIGHT_HEADLIGHT } from '@/presentation/nightLighting'

// Race uses additive blending; keep its exposure below the flyover's normal
// alpha compositing without changing the shared headlight texture.
const RACE_BEAM_ALPHA = 0.62
const RACE_BEAM_SCALE = 0.88

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
          .setAlpha(RACE_BEAM_ALPHA)
          .setScale(RACE_BEAM_SCALE)
        this.beams.push(beam)
      }
      const frontX = (vehicle.headlights[0].x + vehicle.headlights[1].x) / 2
      const frontY = (vehicle.headlights[0].y + vehicle.headlights[1].y) / 2
      beam.setPosition(
        frontX - Math.cos(vehicle.angle) * NIGHT_HEADLIGHT.sourceX * RACE_BEAM_SCALE,
        frontY - Math.sin(vehicle.angle) * NIGHT_HEADLIGHT.sourceX * RACE_BEAM_SCALE,
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

/** Pure viewport decision shared by all night lamp rendering paths. */
export function lampIntersectsViewport(
  lamp: Pick<LampLight, 'center' | 'radius'>,
  bounds?: WorldBounds,
): boolean {
  if (!bounds) return true
  return lamp.center.x + lamp.radius >= bounds.left &&
    lamp.center.x - lamp.radius <= bounds.right &&
    lamp.center.y + lamp.radius >= bounds.top &&
    lamp.center.y - lamp.radius <= bounds.bottom
}

function renderLampGlow(graphics: Phaser.GameObjects.Graphics, lamp: LampLight): void {
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

/** Build immutable additive lamp commands at scene creation, not on every frame.
 * Small ordered chunks keep offscreen glows out of the renderer. Both the
 * road halo and fixture radius contribute to the culling bounds.
 */
export function createNightLampGraphics(
  scene: Phaser.Scene,
  lamps: readonly LampPost[],
  blendMode: number,
): { graphics: Phaser.GameObjects.Graphics; bounds: WorldBounds }[] {
  const lights = buildLampLights(lamps)
  return chunkSpatialItems(lights, ({ center, fixture, radius }) => [
    { x: center.x - radius, y: center.y - radius },
    { x: center.x + radius, y: center.y + radius },
    { x: fixture.x - 6, y: fixture.y - 6 },
    { x: fixture.x + 6, y: fixture.y + 6 },
  ], 8, 0).map(({ items, bounds }) => {
    const graphics = scene.add.graphics()
      .setDepth(WORLD_RENDER_DEPTH.nightLight - 0.01)
      .setBlendMode(blendMode)
    for (const lamp of items) renderLampGlow(graphics, lamp)
    return { graphics, bounds }
  })
}

/** Small fixture glows and brake lights, without a second beam geometry pass. */
export function renderNightLights(
  graphics: Phaser.GameObjects.Graphics,
  lights: readonly VehicleLightTransform[],
  lamps: readonly LampPost[],
  visibleBounds?: WorldBounds,
): void {
  for (const lamp of buildLampLights(lamps)) {
    if (!lampIntersectsViewport(lamp, visibleBounds)) continue
    renderLampGlow(graphics, lamp)
  }

  for (const vehicle of lights) {
    for (const headlight of vehicle.headlights) {
      graphics.fillStyle(0xfff2b2, 0.12)
      graphics.fillCircle(headlight.x, headlight.y, 3.2)
    }
    for (const taillight of vehicle.taillights) {
      graphics.fillStyle(0xff2438, vehicle.braking ? 0.42 : 0.2)
      graphics.fillCircle(taillight.x, taillight.y, vehicle.braking ? 9 : 5)
    }
  }
}
