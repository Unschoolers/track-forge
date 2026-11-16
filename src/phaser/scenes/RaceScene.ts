import { inputForHandling } from '@/phaser/input/raceInput'
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
  renderRecoveryCheckpoints,
} from '@/phaser/rendering/trackRenderer'
import {
  renderVehicleShadows,
  renderVehicles,
  renderGhostVehicle,
  isVehicleAboveStructures,
  transformVehicleLights,
} from '@/phaser/rendering/vehicleRenderer'
import type { SceneControllerPort } from '@/phaser/scenes/EditorScene'
import type { RacePerformance } from '@/infrastructure/qa/racePerformance'
import type { RaceSessionPort } from '@/application/race/raceSession'
import type { RaceControlsPort } from '@/application/ports/input'
import {
  advanceRaceCamera,
  createRaceCamera,
  RACE_CAMERA_TUNING,
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
import { terrainDetailForView } from '@/phaser/rendering/terrainDetail'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { GroundTextureRenderer } from '@/phaser/rendering/environmentRenderer'
import { getTrackEnvironment } from '@/presentation/environments'
import { normalizeTrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { SceneryRenderer } from '@/phaser/rendering/sceneryRenderer'
import { bindRacePointer, type RacePointerBinding } from '@/phaser/input/racePointer'

const EMPTY_SCENERY = [] as const

export class RaceScene extends Phaser.Scene {
  private groundRenderer: GroundTextureRenderer | undefined
  private environmentSceneryRenderer: SceneryRenderer | undefined
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
    private readonly racePerformance?: RacePerformance,
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
    const night = this.raceSession.snapshot().setup?.lighting === 'night'
    const environment = getTrackEnvironment(track.environmentId)
    const palette = night ? environment.night : environment.day
    this.cameras.main.setBackgroundColor(palette.raceGround)
    this.groundRenderer = new GroundTextureRenderer(this)
    this.renderGroundPresentation(night)
    this.terrainGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.terrain)
    this.environmentSceneryRenderer = new SceneryRenderer(this.add.graphics().setDepth(WORLD_RENDER_DEPTH.environmentScenery))
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
      this.raceSession.snapshot().setup?.lighting === 'night',
      terrainDetailForView(geometry.path.terrainSurface.authoredCellCount, 1),
      palette,
    )
    renderTrees(
      this.sceneryGraphics,
      track.trees,
      this.raceSession.snapshot().setup?.lighting === 'night',
      geometry.path.terrainSurface,
    )
    renderTrackGeometryBase(
      this.worldGraphics,
      geometry,
      this.raceSession.snapshot().setup?.lighting === 'night',
    )
    renderTrackGeometryStructureUnderlay(
      structureUnderlayGraphics,
      geometry,
      this.raceSession.snapshot().setup?.lighting === 'night',
    )
    renderTrackGeometryBridgeOverlay(
      bridgeGraphics,
      geometry,
      this.raceSession.snapshot().setup?.lighting === 'night',
    )
    renderTrackGeometryBridgeOverlay(
      wallGraphics,
      geometry,
      this.raceSession.snapshot().setup?.lighting === 'night',
      true,
    )
    this.lamps = buildLampPosts(geometry)
    renderLampPosts(
      this.lampGraphics,
      this.lamps,
      this.raceSession.snapshot().setup?.lighting === 'night',
    )
    renderRecoveryCheckpoints(this.lampGraphics, geometry.path, this.raceSession.snapshot().state?.recoveryCheckpoints ?? [])
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.pointerBinding = bindRacePointer(
      this.game.canvas, 'steering', this.controls, undefined,
      () => this.controller.snapshot().preferences.steeringSensitivity,
      () => (this.controller.snapshot().preferences.steeringLayout ?? 'drag') === 'drag',
    )
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
    const benchmark = this.racePerformance?.beginUpdate()
    this.snapshot = this.controller.snapshot()
    benchmark?.beginSimulation()
    this.raceSession.advance(
      Math.max(0, this.game.loop.rawDelta / 1000),
      inputForHandling(this.controls.snapshot(), this.raceSession.snapshot().setup?.handling),
    )
    benchmark?.endSimulation()
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
          viewport: this.cameras.main,
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
    this.renderGroundPresentation(
      this.raceSession.snapshot().setup?.lighting === 'night',
      this.raceCamera ? -this.raceCamera.angle - Math.PI / 2 : 0,
    )
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
      this.raceSession.snapshot().setup?.lighting === 'night',
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
    const ghost = this.raceSession.snapshot().ghost
    if (ghost) {
      const raised = ghost.structureRunId !== null ||
        ghost.z - race.path.terrainSurface.heightAt(ghost) > 10
      renderGhostVehicle(
        raised ? this.upperVehicleGraphics : this.vehicleGraphics,
        ghost,
      )
    }
    this.nightShadeGraphics?.clear()
    this.nightLightGraphics?.clear()
    if (
      this.raceSession.snapshot().setup?.lighting === 'night' &&
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
    benchmark?.endUpdate()
  }

  private renderGroundPresentation(night: boolean, rotation = 0): void {
    const camera = this.cameras.main
    const track = this.snapshot?.currentTrack
    if (!track) return
    const view = {
        centerX: camera.scrollX + camera.width / 2,
        centerY: camera.scrollY + camera.height / 2,
        width: camera.width,
        height: camera.height,
        zoom: camera.zoom,
        rotation,
        minimumZoom: RACE_CAMERA_TUNING.minimumZoom,
      }
    const environmentId = normalizeTrackEnvironmentId(track.environmentId)
    this.groundRenderer?.render(view, night, environmentId)
    this.environmentSceneryRenderer?.render(view, environmentId, track.scenery ?? EMPTY_SCENERY, night)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return
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
    const race = this.raceSession.snapshot().state
    if (race?.paused || race?.phase === 'finished') return
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
    this.groundRenderer = undefined
    this.raceCamera = undefined
  }
}
