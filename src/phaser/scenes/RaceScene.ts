import { inputForHandling } from '@/phaser/input/raceInput'
import Phaser from 'phaser'
import type { AppSnapshot } from '@/application/appState'
import {
  NightBeamRenderer,
  renderNightLights,
} from '@/phaser/rendering/nightRenderer'
import {
  renderRaceTrackGeometryBase,
  renderTrackGeometryStructureUnderlay,
  renderRecoveryCheckpoints,
} from '@/phaser/rendering/trackRenderer'
import {
  renderVehicleShadows,
  renderVehicles,
  renderGhostVehicle,
  renderNearbyVehicle,
  renderPlayerTopper,
  renderCoveredPlayerOutline,
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
import { buildTerrainPresentation, renderTerrainPrimitives } from '@/phaser/rendering/terrainRenderer'
import { chunkRaceTerrain, terrainChunkVisible, terrainVisibilityWindow } from '@/phaser/rendering/raceTerrainChunks'
import { groundViewportBounds, type WorldBounds } from '@/presentation/environments/groundTexture'
import { terrainDetailForView } from '@/phaser/rendering/terrainDetail'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import {
  getBridgeDeckOcclusion,
  renderBridgeDeck,
  renderBridgeSideWalls,
  type BridgeDeckOcclusion,
} from '@/phaser/rendering/bridgeRenderer'
import type { UpdateRoadRibbonVisibility } from '@/phaser/rendering/roadRibbonRenderer'
import { GroundTextureRenderer } from '@/phaser/rendering/environmentRenderer'
import { getTrackEnvironment } from '@/presentation/environments'
import { normalizeTrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { SceneryRenderer } from '@/phaser/rendering/sceneryRenderer'
import { bindRacePointer, type RacePointerBinding } from '@/phaser/input/racePointer'

const EMPTY_SCENERY = [] as const

export class RaceScene extends Phaser.Scene {
  private groundRenderer: GroundTextureRenderer | undefined
  private environmentSceneryRenderer: SceneryRenderer | undefined
  private terrainChunks: { graphics: Phaser.GameObjects.Graphics; bounds: WorldBounds }[] = []
  private terrainVisibilityBounds: WorldBounds | undefined
  private lightVisibilityBounds: WorldBounds | undefined
  private roadVisibilityBounds: WorldBounds | undefined
  private sceneryGraphics?: Phaser.GameObjects.Graphics
  private updateRoadRibbonVisibility: UpdateRoadRibbonVisibility | undefined
  private shadowGraphics?: Phaser.GameObjects.Graphics
  private vehicleGraphics?: Phaser.GameObjects.Graphics
  private upperVehicleGraphics?: Phaser.GameObjects.Graphics
  private isCoveredByBridgeDeck: BridgeDeckOcclusion | undefined
  private effectGraphics?: Phaser.GameObjects.Graphics
  private lampGraphics?: Phaser.GameObjects.Graphics
  private nightBeamRenderer: NightBeamRenderer | undefined
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
    this.environmentSceneryRenderer = new SceneryRenderer(this.add.graphics().setDepth(WORLD_RENDER_DEPTH.environmentScenery))
    this.sceneryGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.scenery)
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
    if (night) this.nightBeamRenderer = new NightBeamRenderer(this, Phaser.BlendModes.ADD)
    this.nightLightGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.nightLight)
      .setBlendMode(Phaser.BlendModes.ADD)
    const geometry = this.geometry.get(track)
    this.isCoveredByBridgeDeck = getBridgeDeckOcclusion(geometry)
    const terrain = geometry.path.terrainSurface
    this.terrainChunks = chunkRaceTerrain(buildTerrainPresentation(
      terrain, terrainDetailForView(terrain.authoredCellCount, 1),
    )).map(({ primitive, bounds }) => {
      const graphics = this.add.graphics().setDepth(WORLD_RENDER_DEPTH.terrain)
      renderTerrainPrimitives(graphics, [primitive], night, palette)
      return { graphics, bounds }
    })
    renderTrees(
      this.sceneryGraphics,
      track.trees,
      this.raceSession.snapshot().setup?.lighting === 'night',
      geometry.path.terrainSurface,
    )
    this.updateRoadRibbonVisibility = renderRaceTrackGeometryBase(this, geometry, night, normalizeTrackEnvironmentId(track.environmentId))
    renderTrackGeometryStructureUnderlay(
      structureUnderlayGraphics,
      geometry,
      this.raceSession.snapshot().setup?.lighting === 'night',
    )
    renderBridgeDeck(bridgeGraphics, geometry, night, 'terrain', structureUnderlayGraphics)
    renderBridgeSideWalls(wallGraphics, geometry, night)
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
    if (this.raceSession.snapshot().setup?.mode === 'nearby') {
      this.controller.dispatch({ type: 'nearby-scene-ready' })
    }
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
      inputForHandling(this.snapshot.paused ? { steering: 0, throttle: 0, braking: false } : this.controls.snapshot(), this.raceSession.snapshot().setup?.handling),
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
      this.upperVehicleGraphics,
      visibleVehicles,
      race.path,
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
      race.path,
    )
    renderVehicles(
      this.upperVehicleGraphics,
      visibleVehicles.filter(({ id }) => upperVehicles.has(id)),
      race.path,
    )
    if (player && race.missedCheckpoint && race.phase === 'running' && !race.paused) {
      const target = race.missedCheckpoint.position
      const angle = Math.atan2(target.y - player.y, target.x - player.x)
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const alpha = reducedMotion ? 0.8 : 0.55 + 0.3 * Math.sin(_time / 150)
      const graphics = this.upperVehicleGraphics
      graphics.lineStyle(4, 0xff4054, alpha)
      graphics.strokeCircle(player.x, player.y, 25)
      const x = player.x + Math.cos(angle) * 46
      const y = player.y + Math.sin(angle) * 46
      graphics.fillStyle(0xff4054, 0.95)
      graphics.fillTriangle(
        x + Math.cos(angle) * 12, y + Math.sin(angle) * 12,
        x + Math.cos(angle + 2.4) * 10, y + Math.sin(angle + 2.4) * 10,
        x + Math.cos(angle - 2.4) * 10, y + Math.sin(angle - 2.4) * 10,
      )
    }
    // The player's remembered topper is a car cosmetic in every race mode.
    if (player) {
      renderPlayerTopper(
        upperVehicles.has(player.id) ? this.upperVehicleGraphics : this.vehicleGraphics,
        player,
        this.snapshot.preferences.playerIdentity,
      )
    }
    const replayGhost = this.raceSession.snapshot().ghost
    if (replayGhost) {
      const raised = replayGhost.structureRunId !== null ||
        replayGhost.z - race.path.terrainSurface.heightAt(replayGhost) > 10
      renderGhostVehicle(raised ? this.upperVehicleGraphics : this.vehicleGraphics, replayGhost)
    }
    for (const rival of this.raceSession.nearbyGhosts?.() ?? []) {
      const raised = rival.structureRunId !== null ||
        rival.z - race.path.terrainSurface.heightAt(rival) > 10
      renderNearbyVehicle(raised ? this.upperVehicleGraphics : this.vehicleGraphics, rival)
    }
    if (player && !upperVehicles.has(player.id) && this.isCoveredByBridgeDeck?.(player)) {
      renderCoveredPlayerOutline(this.upperVehicleGraphics, player)
    }
    this.nightLightGraphics?.clear()
    if (this.raceSession.snapshot().setup?.lighting === 'night' && this.nightLightGraphics) {
      const lights = visibleVehicles.map((vehicle) =>
        transformVehicleLights(vehicle.car, vehicle, vehicle.braking),
      )
      this.nightBeamRenderer?.render(lights)
      renderNightLights(
        this.nightLightGraphics,
        lights,
        this.lamps,
        this.lightVisibilityBounds,
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
    const viewport = groundViewportBounds(view)
    this.lightVisibilityBounds = viewport
    // Chunk visibility only needs updating when the viewport exits a padded
    // coverage window; all geometry entering the camera is already visible.
    if (this.terrainChunks.length) {
      const next = terrainVisibilityWindow(viewport, this.terrainVisibilityBounds)
      if (next) {
        this.terrainVisibilityBounds = next
        for (const { graphics, bounds } of this.terrainChunks) {
          const visible = terrainChunkVisible(bounds, next)
          if (graphics.visible !== visible) graphics.setVisible(visible)
        }
      }
    }
    // Road markings and ribbons are static. Rechecking all their bounds every
    // animation frame is wasted CPU: a padded visibility window keeps incoming
    // road geometry visible until the camera moves beyond its coverage.
    if (this.updateRoadRibbonVisibility) {
      const nextRoadWindow = terrainVisibilityWindow(viewport, this.roadVisibilityBounds)
      if (nextRoadWindow) {
        this.roadVisibilityBounds = nextRoadWindow
        this.updateRoadRibbonVisibility(view, nextRoadWindow)
      }
    }
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
      if (state?.phase !== 'running' || state.paused || this.controller.snapshot().paused) return
      this.controls.reset()
      this.raceSession.resetPlayer()
      return
    }
    const race = this.raceSession.snapshot().state
    if (race?.paused || race?.phase === 'finished' || this.controller.snapshot().paused) return
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
    this.nightBeamRenderer?.destroy()
    this.nightBeamRenderer = undefined
    this.lamps = []
    this.terrainChunks = []
    this.terrainVisibilityBounds = undefined
    this.lightVisibilityBounds = undefined
    this.roadVisibilityBounds = undefined
    this.groundRenderer = undefined
    this.updateRoadRibbonVisibility = undefined
    this.raceCamera = undefined
    this.isCoveredByBridgeDeck = undefined
  }
}
