import Phaser from 'phaser'
import type { AppSnapshot } from '@/application/appState'
import {
  renderNightLights,
  renderNightShade,
} from '@/phaser/rendering/nightRenderer'
import {
  renderTrackGeometryBase,
  renderTrackGeometryBridgeOverlay,
  renderTrackGeometryStructureUnderlay,
} from '@/phaser/rendering/trackRenderer'
import {
  renderVehicleShadows,
  renderVehicles,
  isVehicleAboveStructures,
  transformVehicleLights,
} from '@/phaser/rendering/vehicleRenderer'
import type { SceneControllerPort } from '@/phaser/scenes/EditorScene'
import type { RaceSessionPort } from '@/application/race/raceSession'
import type { RaceControlsPort } from '@/application/ports/input'
import {
  advanceRaceCamera,
  createRaceCamera,
  type RaceCameraState,
} from '@/phaser/camera/raceCamera'
import { renderRaceEffects } from '@/phaser/rendering/raceEffectsRenderer'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import {
  buildLampPosts,
  renderLampPosts,
  type LampPost,
} from '@/phaser/rendering/lampPostRenderer'
import { renderTrees } from '@/phaser/rendering/treeRenderer'
import { renderTerrain } from '@/phaser/rendering/terrainRenderer'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { bindRacePointer, type RacePointerBinding } from '@/phaser/input/racePointer'

export class RaceScene extends Phaser.Scene {
  private terrainGraphics?: Phaser.GameObjects.Graphics
  private sceneryGraphics?: Phaser.GameObjects.Graphics
  private worldGraphics?: Phaser.GameObjects.Graphics
  private shadowGraphics?: Phaser.GameObjects.Graphics
  private vehicleGraphics?: Phaser.GameObjects.Graphics
  private upperVehicleGraphics?: Phaser.GameObjects.Graphics
  private effectGraphics?: Phaser.GameObjects.Graphics
  private lampGraphics?: Phaser.GameObjects.Graphics
  private nightShadeGraphics?: Phaser.GameObjects.Graphics
  private nightLightGraphics?: Phaser.GameObjects.Graphics
  private lamps: readonly LampPost[] = []
  private snapshot: AppSnapshot | undefined
  private raceCamera: RaceCameraState | undefined
  private pointerBinding: RacePointerBinding | undefined

  constructor(
    private readonly controller: SceneControllerPort,
    private readonly raceSession: RaceSessionPort,
    private readonly controls: RaceControlsPort,
    private readonly geometry: TrackGeometryService,
  ) {
    super({ key: 'RaceScene' })
  }

  create(): void {
    this.snapshot = this.controller.snapshot()
    const track = this.snapshot.currentTrack
    if (!track) {
      this.controller.dispatch({ type: 'go-home' })
      return
    }
    if (!this.raceSession.snapshot().state) {
      this.controller.dispatch({ type: 'go-home' })
      return
    }
    const initialPlayer = this.raceSession
      .snapshot()
      .state?.vehicles.find((vehicle) => vehicle.player)
    if (initialPlayer) this.raceCamera = createRaceCamera(initialPlayer)
    this.cameras.main.setBackgroundColor(
      this.snapshot.preferences.lighting === 'night' ? '#0e2b1d' : '#2d7344',
    )
    this.terrainGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.terrain)
    this.sceneryGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.scenery)
    this.worldGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.road)
    const structureUnderlayGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.structureUnderlay)
    this.shadowGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.vehicleShadow)
    this.vehicleGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.lowerVehicle)
    const bridgeGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.structureDeck)
    const wallGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.structureWall)
    this.upperVehicleGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.upperVehicle)
    this.lampGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.lamp)
    this.effectGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.effect)
    this.nightShadeGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.nightShade)
    this.nightLightGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.nightLight)
      .setBlendMode(Phaser.BlendModes.ADD)
    const geometry = this.geometry.get(track)
    renderTerrain(
      this.terrainGraphics,
      geometry.path.terrainSurface,
      this.snapshot.preferences.lighting === 'night',
    )
    renderTrees(
      this.sceneryGraphics,
      track.trees,
      this.snapshot.preferences.lighting === 'night',
      geometry.path.terrainSurface,
    )
    renderTrackGeometryBase(
      this.worldGraphics,
      geometry,
      this.snapshot.preferences.lighting === 'night',
    )
    renderTrackGeometryStructureUnderlay(
      structureUnderlayGraphics,
      geometry,
      this.snapshot.preferences.lighting === 'night',
    )
    renderTrackGeometryBridgeOverlay(
      bridgeGraphics,
      geometry,
      this.snapshot.preferences.lighting === 'night',
    )
    renderTrackGeometryBridgeOverlay(
      wallGraphics,
      geometry,
      this.snapshot.preferences.lighting === 'night',
      true,
    )
    this.lamps = buildLampPosts(geometry)
    renderLampPosts(
      this.lampGraphics,
      this.lamps,
      this.snapshot.preferences.lighting === 'night',
    )
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.pointerBinding = bindRacePointer(this.game.canvas, 'steering', this.controls)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.dispose, this)
  }

  override update(_time: number, deltaMilliseconds: number): void {
    if (
      !this.vehicleGraphics ||
      !this.shadowGraphics ||
      !this.upperVehicleGraphics ||
      !this.effectGraphics ||
      !this.snapshot
    ) return
    this.snapshot = this.controller.snapshot()
    this.raceSession.advance(
      Math.max(0, this.game.loop.rawDelta / 1000),
      this.controls.snapshot(),
    )
    const race = this.raceSession.snapshot().state
    if (!race) return
    const player = race.vehicles.find((vehicle) => vehicle.player)
    if (player && this.raceCamera) {
      this.raceCamera = advanceRaceCamera(
        this.raceCamera,
        race.cameraHints,
        {
          dynamicZoom: this.snapshot.preferences.dynamicZoomEnabled,
          steering: this.controls.snapshot().steering,
        },
        Math.min(0.033, deltaMilliseconds / 1000),
      )
      this.cameras.main.centerOn(
        this.raceCamera.x + this.raceCamera.shake.x,
        this.raceCamera.y + this.raceCamera.shake.y,
      )
      this.cameras.main.setZoom(this.raceCamera.zoom)
      this.cameras.main.setRotation(-this.raceCamera.angle - Math.PI / 2)
    }
    this.vehicleGraphics.clear()
    this.shadowGraphics.clear()
    this.upperVehicleGraphics.clear()
    this.effectGraphics.clear()
    renderRaceEffects(this.effectGraphics, race.effects)
    const visibleVehicles = race.vehicles.filter(
      (vehicle) => vehicle.player || vehicle.finishedAt === null,
    )
    renderVehicleShadows(
      this.shadowGraphics,
      visibleVehicles,
      race.path.terrainSurface,
      this.snapshot.preferences.lighting === 'night',
    )
    const upperVehicles = new Set(
      visibleVehicles
        .filter(
          (vehicle) => isVehicleAboveStructures(vehicle, race.path),
        )
        .map(({ id }) => id),
    )
    renderVehicles(
      this.vehicleGraphics,
      visibleVehicles.filter(({ id }) => !upperVehicles.has(id)),
    )
    renderVehicles(
      this.upperVehicleGraphics,
      visibleVehicles.filter(({ id }) => upperVehicles.has(id)),
    )
    this.nightShadeGraphics?.clear()
    this.nightLightGraphics?.clear()
    if (
      this.snapshot.preferences.lighting === 'night' &&
      this.nightShadeGraphics &&
      this.nightLightGraphics
    ) {
      const cameraCenter = {
        x: (this.raceCamera?.x ?? 0) + (this.raceCamera?.shake.x ?? 0),
        y: (this.raceCamera?.y ?? 0) + (this.raceCamera?.shake.y ?? 0),
      }
      renderNightShade(this.nightShadeGraphics, {
        width: this.scale.width,
        height: this.scale.height,
        cameraCenter,
        cameraZoom: this.raceCamera?.zoom ?? 1,
      })
      renderNightLights(
        this.nightLightGraphics,
        visibleVehicles.map((vehicle) =>
          transformVehicleLights(
            vehicle.car,
            vehicle,
            vehicle.braking,
          ),
        ),
        this.lamps,
      )
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.controller.dispatch({ type: 'pause-race' })
      return
    }
    if (event.key.toLowerCase() === 'r' && !event.repeat) {
      const state = this.raceSession.snapshot().state
      if (state?.phase !== 'running' || state.paused) return
      this.controls.reset()
      this.raceSession.resetPlayer()
      return
    }
    this.controls.setKeyboard(event.key, true)
  }
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.controls.setKeyboard(event.key, false)
  }
  private readonly onBlur = (): void => this.controls.reset()
  private readonly onVisibility = (): void => {
    if (document.hidden) this.onBlur()
  }

  private dispose(): void {
    this.controls.reset()
    this.pointerBinding?.destroy()
    this.pointerBinding = undefined
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.lamps = []
  }
}
