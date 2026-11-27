import type Phaser from 'phaser'
import type { WorldBounds } from '@/presentation/environments/groundTexture'
import type { VehicleLightTransform } from '@/phaser/rendering/vehicleRenderer'
import { buildLampLights, LAMP_LIGHT_PROFILE, type LampLight, type LampPost } from '@/phaser/rendering/lampPostRenderer'
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

// Shared exposure and geometry for the vector fallback and baked additive art.
const ROAD_GLOW = [
  { radius: 1, color: 0xffd88a, alpha: 0.14 },
  { radius: 0.68, color: 0xffdf98, alpha: 0.3 },
  { radius: 0.38, color: 0xffe7ae, alpha: 0.52 },
] as const
const FIXTURE_GLOW = [
  { radius: 6, color: 0xffe4a3, alpha: 1.35 },
  { radius: 2.8, color: 0xfff0bf, alpha: 1.9 },
] as const

function renderLampGlow(graphics: Phaser.GameObjects.Graphics, lamp: LampLight): void {
  for (const ring of ROAD_GLOW) {
    graphics.fillStyle(ring.color, lamp.intensity * ring.alpha)
    graphics.fillCircle(lamp.center.x, lamp.center.y, lamp.radius * ring.radius)
  }
  for (const ring of FIXTURE_GLOW) {
    graphics.fillStyle(ring.color, lamp.intensity * ring.alpha)
    graphics.fillCircle(lamp.fixture.x, lamp.fixture.y, ring.radius)
  }
}

const LAMP_ATLAS_KEY = 'trackforge-night-lamp-glow-v1'
const HALO_DENSITY = 2
const HALO_FRAMES = [
  { name: 'road', x: 0, y: 0, size: 96, ...LAMP_LIGHT_PROFILE.road, rings: ROAD_GLOW },
  { name: 'bridge-road', x: 96, y: 0, size: 112, ...LAMP_LIGHT_PROFILE.bridge, rings: ROAD_GLOW },
  { name: 'fixture', x: 0, y: 112, size: 16, radius: 1, intensity: LAMP_LIGHT_PROFILE.road.intensity, rings: FIXTURE_GLOW },
  { name: 'bridge-fixture', x: 16, y: 112, size: 16, radius: 1, intensity: LAMP_LIGHT_PROFILE.bridge.intensity, rings: FIXTURE_GLOW },
] as const

/** Add the concentric rings once in premultiplied canvas space. On the opaque
 * race background, Phaser ADD then sums the baked contribution just as it
 * summed the separate circles. Transparent gutters keep filtering isolated. */
function registerLampAtlas(scene: Phaser.Scene): string {
  if (scene.textures.exists(LAMP_ATLAS_KEY)) return LAMP_ATLAS_KEY
  const canvas = document.createElement('canvas')
  canvas.width = 208 * HALO_DENSITY
  canvas.height = 128 * HALO_DENSITY
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create night lamp atlas canvas')
  context.scale(HALO_DENSITY, HALO_DENSITY)
  context.globalCompositeOperation = 'lighter'
  for (const frame of HALO_FRAMES) {
    for (const ring of frame.rings) {
      context.globalAlpha = frame.intensity * ring.alpha
      context.fillStyle = '#' + ring.color.toString(16).padStart(6, '0')
      context.beginPath()
      context.arc(frame.x + frame.size / 2, frame.y + frame.size / 2,
        frame.radius * ring.radius, 0, Math.PI * 2)
      context.fill()
    }
  }
  const texture = scene.textures.addCanvas(LAMP_ATLAS_KEY, canvas)
  if (!texture) throw new Error('Could not register night lamp atlas')
  try {
    for (const frame of HALO_FRAMES) {
      if (!texture.add(frame.name, 0, frame.x * HALO_DENSITY, frame.y * HALO_DENSITY,
        frame.size * HALO_DENSITY, frame.size * HALO_DENSITY)) {
        throw new Error('Could not register night lamp frame ' + frame.name)
      }
    }
  } catch (error) {
    scene.textures.remove(LAMP_ATLAS_KEY)
    throw error
  }
  return LAMP_ATLAS_KEY
}

export interface NightLampBatch {
  readonly graphics: { readonly visible: boolean; setVisible(visible: boolean): unknown }
  readonly bounds: WorldBounds
}

/** WebGL path: two tightly fitted additive quads replace five vector circles.
 * Both use a single shared atlas; culling can hide a lamp independently, without
 * recreating artwork or inserting container/render-target boundaries. */
export function createNightLampSprites(
  scene: Phaser.Scene,
  lamps: readonly LampPost[],
  blendMode: number,
): NightLampBatch[] {
  if (!lamps.length) return []
  const texture = registerLampAtlas(scene)
  return buildLampLights(lamps).map(lamp => {
    const prefix = lamp.bridge ? 'bridge-' : ''
    const roadSize = lamp.bridge ? 112 : 96
    const image = (x: number, y: number, frame: string, size: number) =>
      scene.add.image(x, y, texture, prefix + frame)
        .setOrigin(0.5).setDisplaySize(size, size)
        .setDepth(WORLD_RENDER_DEPTH.nightLight - 0.01).setBlendMode(blendMode)
    const road = image(lamp.center.x, lamp.center.y, 'road', roadSize)
    const fixture = image(lamp.fixture.x, lamp.fixture.y, 'fixture', 16)
    return {
      graphics: {
        get visible() { return road.visible },
        setVisible(visible: boolean) { road.setVisible(visible); fixture.setVisible(visible) },
      },
      bounds: {
        left: Math.min(lamp.center.x - roadSize / 2, lamp.fixture.x - 8),
        top: Math.min(lamp.center.y - roadSize / 2, lamp.fixture.y - 8),
        right: Math.max(lamp.center.x + roadSize / 2, lamp.fixture.x + 8),
        bottom: Math.max(lamp.center.y + roadSize / 2, lamp.fixture.y + 8),
      },
    }
  })
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
