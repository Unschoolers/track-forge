import { inputForPedals } from '@/phaser/input/raceInput'
import { manualRecoveryTicksRemaining } from '@/domain/race/raceState'
import { manualRecoverySignal } from '@/application/race/racePresentation'
import Phaser from 'phaser'
import type { AppSnapshot } from '@/application/appState'
import {
  NightBeamRenderer,
  createNightLampGraphics,
  renderNightLights,
} from '@/phaser/rendering/nightRenderer'
import {
  renderRaceTrackGeometryBase,
  renderRecoveryCheckpoints,
  type RaceTrackVisibility,
} from '@/phaser/rendering/trackRenderer'
import {
  renderVehicleShadows,
  renderVehicles,
  renderGhostVehicle,
  renderNearbyVehicle,
  renderPlayerTopper,
  renderBoostFlames,
  renderCoveredPlayerOutline,
  isVehicleAboveStructures,
  transformVehicleLights,
} from '@/phaser/rendering/vehicleRenderer'
import type { SceneControllerPort } from '@/phaser/scenes/EditorScene'
import type { RaceFrameDiagnostics } from '@/infrastructure/qa/raceFrameDiagnostics'
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
} from '@/phaser/rendering/lampPostRenderer'
import { renderTrees } from '@/phaser/rendering/treeRenderer'
import { buildTerrainPresentation, renderTerrainPrimitives } from '@/phaser/rendering/terrainRenderer'
import { chunkRaceTerrain, chunkSpatialItems, terrainChunkVisible, terrainVisibilityWindow } from '@/phaser/rendering/raceTerrainChunks'
import { groundViewportBounds, type WorldBounds } from '@/presentation/environments/groundTexture'
import { terrainDetailForView } from '@/phaser/rendering/terrainDetail'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { VehicleSpriteRenderer } from '@/phaser/rendering/vehicleSpriteRenderer'
import { TOPPER_COLORS } from '@/application/multiplayer/playerIdentity'
import {
  buildBridgePresentation,
  bridgeRenderPasses,
  chunkBridgePrimitives,
  getBridgeDeckOcclusion,
  renderBridgeDeck,
  renderBridgeSideWalls,
  renderBridgeUnderlay,
  type BridgeDeckOcclusion,
} from '@/phaser/rendering/bridgeRenderer'
import { GroundTextureRenderer } from '@/phaser/rendering/environmentRenderer'
import { getTrackEnvironment } from '@/presentation/environments'
import { normalizeTrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { SceneryRenderer } from '@/phaser/rendering/sceneryRenderer'
import { bindRacePointer, type RacePointerBinding } from '@/phaser/input/racePointer'

const EMPTY_SCENERY = [] as const
const EMPTY_BITMAP_COVERAGE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const

export class RaceScene extends Phaser.Scene {
  private groundRenderer: GroundTextureRenderer | undefined
  private environmentSceneryRenderer: SceneryRenderer | undefined
  private terrainChunks: { graphics: Phaser.GameObjects.Graphics; bounds: WorldBounds; hill: boolean; primitives: number }[] = []
  // Updated only when the culling window changes, not for every display frame.
  private hillBatches = 0
  private hillPrimitives = 0
  private waterBatches = 0
  private waterPrimitives = 0
  private bridgeBatches = 0
  private bridgePrimitives = 0
  private lampBatches = 0
  private terrainVisibilityBounds: WorldBounds | undefined
  private roadVisibilityBounds: WorldBounds | undefined
  private updateRoadRibbonVisibility: RaceTrackVisibility | undefined
  private shadowGraphics?: Phaser.GameObjects.Graphics
  private vehicleGraphics?: Phaser.GameObjects.Graphics
  private upperVehicleGraphics?: Phaser.GameObjects.Graphics
  private upperShadowGraphics: Phaser.GameObjects.Graphics | undefined
  private vehicleSprites: VehicleSpriteRenderer | undefined
  private isCoveredByBridgeDeck: BridgeDeckOcclusion | undefined
  private effectGraphics?: Phaser.GameObjects.Graphics
  private lampGraphics: { graphics: Phaser.GameObjects.Graphics; bounds: WorldBounds }[] = []
  private bridgeGraphics: { graphics: Phaser.GameObjects.Graphics; bounds: WorldBounds; primitives: number }[] = []
  private staticGraphicsVisibilityBounds: WorldBounds | undefined
  private nightBeamRenderer: NightBeamRenderer | undefined
  private nightLightGraphics?: Phaser.GameObjects.Graphics
  private checkpointGraphics?: Phaser.GameObjects.Graphics
  private renderedNextCheckpoint: number | undefined
  private snapshot: AppSnapshot | undefined
  private raceCamera: RaceCameraState | undefined
  private pointerBinding: RacePointerBinding | undefined
  private boostRequestPending = false
  private cupCameraIntro = false

  constructor(
    private readonly controller: SceneControllerPort,
    private readonly raceSession: RaceSessionPort,
    private readonly controls: RaceControlsPort,
    private readonly geometry: TrackGeometryService,
    private readonly racePerformance?: RacePerformance,
    private readonly frameDiagnostics?: RaceFrameDiagnostics,
    private readonly renderPixelRatio: () => number = () => 1,
  ) {
    super({ key: 'RaceScene' })
  }

  create(): void {
    this.snapshot = this.controller.snapshot()
    this.cupCameraIntro = Boolean(this.snapshot.cup && this.snapshot.preferences.dynamicZoomEnabled &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
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
    if (this.frameDiagnostics) {
      const canvas = this.game.canvas
      const display = canvas.getBoundingClientRect()
      this.frameDiagnostics.setRenderer(this.game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas',
        canvas.width, canvas.height, {
          cssWidth: display.width, cssHeight: display.height, devicePixelRatio: window.devicePixelRatio,
        })
    }
    const night = this.raceSession.snapshot().setup?.lighting === 'night'
    const environment = getTrackEnvironment(track.environmentId)
    const palette = night ? environment.night : environment.day
    this.cameras.main.setBackgroundColor(palette.raceGround)
    this.cameras.main.setZoom(this.renderPixelRatio())
    this.groundRenderer = new GroundTextureRenderer(this)
    this.renderGroundPresentation(night)
    this.environmentSceneryRenderer = new SceneryRenderer(this.add.graphics().setDepth(WORLD_RENDER_DEPTH.environmentScenery))
    const sceneryGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.scenery)
    this.shadowGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.vehicleShadow)
    this.vehicleGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.lowerVehicle)
    this.upperVehicleGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.upperVehicle)
    this.upperShadowGraphics = this.add.graphics().setDepth(WORLD_RENDER_DEPTH.upperVehicle - 0.2)
    this.vehicleSprites = new VehicleSpriteRenderer(this)
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
    this.updateRoadRibbonVisibility = renderRaceTrackGeometryBase(this, geometry, night, normalizeTrackEnvironmentId(track.environmentId))
    const bitmap = this.updateRoadRibbonVisibility?.bitmap
    const terrain = geometry.path.terrainSurface
    // Complete race atlas includes terrain and projected hill shadows.
    // Do not allocate any duplicate vector graphics when artwork is available.
    const terrainPrimitives = bitmap ? [] : buildTerrainPresentation(terrain, terrainDetailForView(terrain.authoredCellCount, 1))
    this.terrainChunks = chunkRaceTerrain(terrainPrimitives).map(({ primitive, bounds }) => {
      const graphics = this.add.graphics().setDepth(WORLD_RENDER_DEPTH.terrain)
      renderTerrainPrimitives(graphics, [primitive], night, palette)
      const hill = primitive.kind === 'hill-shadow' || primitive.kind === 'hill-slope' || primitive.kind === 'hill-plateau'
      const primitives = primitive.kind === 'shoreline'
        ? primitive.rings.reduce((count, ring) => count + ring.length, 0)
        : primitive.kind === 'water' ? primitive.triangles.length + primitive.texture.length
        : primitive.kind === 'hill-slope' ? primitive.facets.length : primitive.triangles.length
      return { graphics, bounds, hill, primitives }
    })
    // Trees are static during a race. Build once rather than rebuilding
    // shadow commands and reallocating sprites as the camera moves.
    renderTrees(
      sceneryGraphics,
      track.trees,
      this.raceSession.snapshot().setup?.lighting === 'night',
      geometry.path.terrainSurface,
      normalizeTrackEnvironmentId(track.environmentId),
      undefined,
      this.game.renderer !== undefined && this.game.renderer.type === Phaser.WEBGL && typeof this.add.spriteGPULayer === 'function',
    )
    if (bitmap && this.raceCamera) {
      const camera = this.cameras.main
      const view = {
        centerX: this.raceCamera.x, centerY: this.raceCamera.y,
        width: camera.width / this.renderPixelRatio(), height: camera.height / this.renderPixelRatio(),
        zoom: this.presentationZoom(
          this.snapshot.preferences.dynamicZoomEnabled ? this.raceCamera.zoom : RACE_CAMERA_TUNING.fixedZoom,
          this.raceSession.snapshot().state?.countdown ?? 0,
        ),
        rotation: -this.raceCamera.angle - Math.PI / 2,
        minimumZoom: RACE_CAMERA_TUNING.minimumZoom,
      }
      const bounds = terrainVisibilityWindow(groundViewportBounds(view))
      bitmap.render(view, bounds ?? undefined)
      bitmap.warmVisible()
    }
    if (!bitmap) {
      const bridgePresentation = buildBridgePresentation(geometry)
      const bridgeEnvironment = normalizeTrackEnvironmentId(track.environmentId)
      const bridgeNight = this.raceSession.snapshot().setup?.lighting === 'night'
      const drawBridgeBatches = (items: typeof bridgePresentation, depth: number, draw: (graphics: Phaser.GameObjects.Graphics, items: typeof bridgePresentation) => void) => {
        for (const batch of chunkBridgePrimitives(items)) {
          const graphics = this.add.graphics().setDepth(depth)
          draw(graphics, batch.items)
          this.bridgeGraphics.push({ graphics, bounds: batch.bounds, primitives: batch.items.length })
        }
      }
      const bridgePasses = bridgeRenderPasses(bridgePresentation)
      drawBridgeBatches(bridgePasses.underlay, WORLD_RENDER_DEPTH.structureUnderlay, (graphics, items) =>
        renderBridgeUnderlay(graphics, geometry, bridgeNight, 'terrain', bridgeEnvironment, items))
      drawBridgeBatches(bridgePasses.rampApproach, WORLD_RENDER_DEPTH.structureUnderlay, (graphics, items) =>
        renderBridgeDeck(graphics, geometry, night, 'terrain', graphics, bridgeEnvironment, items))
      drawBridgeBatches(bridgePasses.deck, WORLD_RENDER_DEPTH.structureDeck, (graphics, items) =>
        renderBridgeDeck(graphics, geometry, night, 'terrain', graphics, bridgeEnvironment, items))
      drawBridgeBatches(bridgePasses.walls, WORLD_RENDER_DEPTH.structureWall, (graphics, items) =>
        renderBridgeSideWalls(graphics, geometry, night, 'terrain', bridgeEnvironment, items))
    }
    const lamps = buildLampPosts(geometry)
    for (const batch of chunkSpatialItems(lamps, lamp => [lamp.position, lamp.shadowEnd], 64, 8)) {
      const graphics = this.add.graphics().setDepth(WORLD_RENDER_DEPTH.lamp)
      renderLampPosts(graphics, batch.items, night)
      this.lampGraphics.push({ graphics, bounds: batch.bounds })
    }
    if (night) {
      this.lampGraphics.push(...createNightLampGraphics(this, lamps, Phaser.BlendModes.ADD))
    }
    this.checkpointGraphics = this.add.graphics().setDepth(WORLD_RENDER_DEPTH.lamp)
    const initialRace = this.raceSession.snapshot().state
    this.renderedNextCheckpoint = initialPlayer && initialRace
      ? initialRace.timingGates?.[initialPlayer.nextSector - 1]
      : undefined
    renderRecoveryCheckpoints(this.checkpointGraphics, geometry.path, initialRace?.recoveryCheckpoints ?? [], undefined, this.renderedNextCheckpoint)
    // The initial ground pass happens before lamp batches exist; force their
    // first visibility update to use the race camera's actual viewport.
    this.staticGraphicsVisibilityBounds = undefined
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

  override update(_time: number, _deltaMilliseconds: number): void {
    if (
      !this.vehicleGraphics ||
      !this.shadowGraphics ||
      !this.upperVehicleGraphics ||
      !this.effectGraphics ||
      !this.snapshot
    ) return
    const benchmark = this.racePerformance?.beginUpdate()
    const runId = this.raceSession.snapshot().runId
    if (runId !== undefined) this.frameDiagnostics?.beginUpdate(runId)
    this.snapshot = this.controller.snapshot()
    benchmark?.beginSimulation()
    this.frameDiagnostics?.beginSimulation()
    // Use one real display-frame delta for physics accumulation and camera
    // following. Phaser's smoothed scene delta can diverge at high refresh.
    const frameSeconds = Math.max(0, this.game.loop.rawDelta / 1000)
    const sessionBeforeAdvance = this.raceSession.snapshot()
    const boostPractice = sessionBeforeAdvance.setup?.mode === 'boost-practice'
    const boostInputOpen = boostPractice && !this.snapshot.paused &&
      !sessionBeforeAdvance.state?.paused && sessionBeforeAdvance.state?.phase === 'running'
    if (!boostInputOpen) {
      this.boostRequestPending = false
      this.controls.consumeBoostRequest()
    } else if (this.controls.consumeBoostRequest()) {
      this.boostRequestPending = true
    }
    const input = this.snapshot.paused
      ? { steering: 0, throttle: 0, braking: false }
      : inputForPedals(this.controls.snapshot(), this.snapshot.preferences.pedalMode)
    this.raceSession.advance(
      frameSeconds,
      boostInputOpen
        ? { ...input, boostRequested: this.boostRequestPending }
        : input,
    )
    const sessionAfterAdvance = this.raceSession.snapshot()
    if (
      this.boostRequestPending &&
      sessionAfterAdvance.state &&
      sessionBeforeAdvance.state &&
      sessionAfterAdvance.state.tick > sessionBeforeAdvance.state.tick
    ) {
      this.boostRequestPending = false
    }
    benchmark?.endSimulation()
    this.frameDiagnostics?.endSimulation()
    // Draw interpolated poses while the simulation, HUD, and network
    // systems continue to use the authoritative 60 Hz state.
    const race = this.raceSession.presentationState?.() ?? this.raceSession.snapshot().state
    if (!race) return
    const player = race.vehicles.find((vehicle) => vehicle.player)
    const nextCheckpoint = player ? race.timingGates?.[player.nextSector - 1] : undefined
    if (nextCheckpoint !== this.renderedNextCheckpoint && this.checkpointGraphics) {
      this.renderedNextCheckpoint = nextCheckpoint
      this.checkpointGraphics.clear()
      renderRecoveryCheckpoints(this.checkpointGraphics, race.path, race.recoveryCheckpoints ?? [], undefined, nextCheckpoint)
    }
    if (player && this.raceCamera) {
      this.raceCamera = advanceRaceCamera(
        this.raceCamera,
        race.cameraHints,
        {
          dynamicZoom: this.snapshot.preferences.dynamicZoomEnabled,
          steering: this.controls.snapshot().steering,
          viewport: {
            width: this.cameras.main.width / this.renderPixelRatio(),
            height: this.cameras.main.height / this.renderPixelRatio(),
          },
        },
        Math.min(0.033, frameSeconds),
      )
      this.cameras.main.centerOn(
        this.raceCamera.x + this.raceCamera.shake.x,
        this.raceCamera.y + this.raceCamera.shake.y,
      )
      this.cameras.main.setZoom(this.presentationZoom(this.raceCamera.zoom, race.countdown) * this.renderPixelRatio())
      this.cameras.main.setRotation(-this.raceCamera.angle - Math.PI / 2)
    }
    const cameraRotation = this.raceCamera ? -this.raceCamera.angle - Math.PI / 2 : 0
    this.frameDiagnostics?.beginGround()
    this.renderGroundPresentation(
      this.raceSession.snapshot().setup?.lighting === 'night',
      cameraRotation,
    )
    this.frameDiagnostics?.endGround()
    this.vehicleGraphics.clear()
    this.shadowGraphics.clear()
    this.upperVehicleGraphics.clear()
    this.upperShadowGraphics?.clear()
    this.vehicleSprites?.beginFrame()
    this.effectGraphics.clear()
    renderRaceEffects(this.effectGraphics, race.effects)
    const restart = manualRecoverySignal(race)
    if (player && restart) {
      // Counter-rotate and scale to keep the local signal upright and legible.
      const graphics = this.effectGraphics
      const camera = this.cameras.main
      graphics.save()
      graphics.translateCanvas(player.x, player.y)
      graphics.rotateCanvas(-cameraRotation)
      graphics.scaleCanvas(this.renderPixelRatio() / camera.zoom, this.renderPixelRatio() / camera.zoom)
      graphics.fillStyle(0x101820, 0.9 * restart.alpha)
      graphics.fillRoundedRect(-24, -54, 48, 22, 8)
      graphics.fillStyle(restart.color, restart.alpha)
      graphics.fillCircle(0, -46, 5)
      graphics.fillStyle(0xffffff, 0.18 * restart.alpha)
      graphics.fillRect(-17, -38, 34, 3)
      graphics.fillStyle(restart.color, restart.alpha)
      graphics.fillRect(-17, -38, 34 * restart.progress, 3)
      graphics.restore()
    }
    const visibleVehicles = race.vehicles.filter(
      (vehicle) => vehicle.player || vehicle.finishedAt === null,
    )
    renderVehicleShadows(
      this.shadowGraphics,
      this.upperShadowGraphics ?? this.upperVehicleGraphics,
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
    // Arcade rivals may overlap the player without physical collisions.
    // Paint the player last within the same height layer; bridge/underpass
    // occlusion, physics, shadow order and lighting remain unchanged.
    const forPaint = (raised: boolean) => visibleVehicles
      .filter(({ id }) => upperVehicles.has(id) === raised)
      .sort((a, b) => Number(a.player) - Number(b.player))
    if (boostPractice && player) {
      const graphics = upperVehicles.has(player.id) ? this.upperVehicleGraphics : this.vehicleGraphics
      const supportHeight = race.path.roadSurface.at(player.pathIndex, player).height
      if (graphics) {
        renderBoostFlames(
          graphics,
          player,
          TOPPER_COLORS[this.snapshot.preferences.playerIdentity?.color ?? 'cyan'],
          (_time % 240) / 240,
          Math.max(0, player.z - supportHeight),
        )
      }
    }
    renderVehicles(this.vehicleGraphics, forPaint(false), race.path, this.vehicleSprites)
    renderVehicles(this.upperVehicleGraphics, forPaint(true), race.path, this.vehicleSprites)
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
      renderNearbyVehicle(raised ? this.upperVehicleGraphics : this.vehicleGraphics, rival, this.vehicleSprites,
        raised ? this.upperShadowGraphics : this.shadowGraphics)
    }
    this.vehicleSprites?.endFrame()
    if (player && !upperVehicles.has(player.id) && this.isCoveredByBridgeDeck?.(player)) {
      renderCoveredPlayerOutline(this.upperVehicleGraphics, player)
    }
    this.frameDiagnostics?.endVehicles()
    this.nightLightGraphics?.clear()
    if (this.raceSession.snapshot().setup?.lighting === 'night' && this.nightLightGraphics) {
      const lights = visibleVehicles.map((vehicle) =>
        transformVehicleLights(vehicle.car, vehicle, vehicle.braking),
      )
      this.nightBeamRenderer?.render(lights)
      // Streetlamp halos are static and already present in the culled batches.
      renderNightLights(this.nightLightGraphics, lights, [])
    }
    benchmark?.endUpdate()
    this.frameDiagnostics?.endUpdate()
    if (this.frameDiagnostics) {
      const camera = this.cameras.main
      this.frameDiagnostics.recordPresentation([
        camera.scrollX + camera.width / 2, camera.scrollY + camera.height / 2, camera.zoom / this.renderPixelRatio(), cameraRotation,
        this.hillBatches, this.hillPrimitives, this.waterBatches, this.waterPrimitives,
        this.bridgeBatches, this.bridgePrimitives, this.lampBatches,
        ...(this.updateRoadRibbonVisibility?.bitmap?.coverage() ?? EMPTY_BITMAP_COVERAGE),
      ])
    }
  }

  private presentationZoom(zoom: number, countdown: number): number {
    if (!this.cupCameraIntro || countdown <= 1) return zoom
    // Start wider to show the grid and surroundings, then settle before GO.
    const remaining = Math.min(1, (countdown - 1) / 2.7)
    return zoom * (1 - 0.14 * remaining * remaining)
  }

  private renderGroundPresentation(night: boolean, rotation = 0): void {
    const camera = this.cameras.main
    const track = this.snapshot?.currentTrack
    if (!track) return
    const view = {
        centerX: camera.scrollX + camera.width / 2,
        centerY: camera.scrollY + camera.height / 2,
        width: camera.width / this.renderPixelRatio(),
        height: camera.height / this.renderPixelRatio(),
        zoom: camera.zoom / this.renderPixelRatio(),
        rotation,
        minimumZoom: RACE_CAMERA_TUNING.minimumZoom,
      }
    const environmentId = normalizeTrackEnvironmentId(track.environmentId)
    this.groundRenderer?.render(view, night, environmentId)
    const viewport = groundViewportBounds(view)
    // Chunk visibility only needs updating when the viewport exits a padded
    // coverage window; all geometry entering the camera is already visible.
    if (this.terrainChunks.length) {
      const next = terrainVisibilityWindow(viewport, this.terrainVisibilityBounds)
      if (next) {
        this.terrainVisibilityBounds = next
        this.hillBatches = this.hillPrimitives = this.waterBatches = this.waterPrimitives = 0
        for (const { graphics, bounds, hill, primitives } of this.terrainChunks) {
          const visible = terrainChunkVisible(bounds, next)
          if (graphics.visible !== visible) graphics.setVisible(visible)
          if (visible) {
            if (hill) { this.hillBatches++; this.hillPrimitives += primitives }
            else { this.waterBatches++; this.waterPrimitives += primitives }
          }
        }
      }
    }
    const nextStaticWindow = terrainVisibilityWindow(viewport, this.staticGraphicsVisibilityBounds)
    if (nextStaticWindow) {
      this.staticGraphicsVisibilityBounds = nextStaticWindow
      this.lampBatches = this.bridgeBatches = this.bridgePrimitives = 0
      for (const { graphics, bounds } of this.lampGraphics) {
        const visible = terrainChunkVisible(bounds, nextStaticWindow)
        if (graphics.visible !== visible) graphics.setVisible(visible)
        if (visible) this.lampBatches++
      }
      for (const { graphics, bounds, primitives } of this.bridgeGraphics) {
        const visible = terrainChunkVisible(bounds, nextStaticWindow)
        if (graphics.visible !== visible) graphics.setVisible(visible)
        if (visible) { this.bridgeBatches++; this.bridgePrimitives += primitives }
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
      } else {
        // Prefetch heading changes independently of static geometry culling.
        this.updateRoadRibbonVisibility.bitmap?.render(view, this.roadVisibilityBounds)
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
      if (state?.phase !== 'running' || state.paused || this.controller.snapshot().paused ||
          manualRecoveryTicksRemaining(state.vehicles.find(vehicle => vehicle.player), state.tick) > 0) return
      this.controls.reset()
      this.boostRequestPending = false
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
  private readonly onBlur = (): void => {
    this.controls.reset()
    this.boostRequestPending = false
  }
  private readonly onVisibility = (): void => {
    if (document.hidden) this.onBlur()
  }

  private dispose(): void {
    this.frameDiagnostics?.endRace()
    this.controls.reset()
    this.boostRequestPending = false
    this.pointerBinding?.destroy()
    this.pointerBinding = undefined
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.vehicleSprites?.destroy()
    this.vehicleSprites = undefined
    this.upperShadowGraphics = undefined
    this.nightBeamRenderer?.destroy()
    this.nightBeamRenderer = undefined
    this.terrainChunks = []
    this.hillBatches = this.hillPrimitives = this.waterBatches = this.waterPrimitives = 0
    this.bridgeBatches = this.bridgePrimitives = this.lampBatches = 0
    this.terrainVisibilityBounds = undefined
    this.roadVisibilityBounds = undefined
    this.staticGraphicsVisibilityBounds = undefined
    this.lampGraphics = []
    this.bridgeGraphics = []
    this.groundRenderer = undefined
    this.environmentSceneryRenderer?.destroy()
    this.environmentSceneryRenderer = undefined
    this.updateRoadRibbonVisibility = undefined
    this.raceCamera = undefined
    this.isCoveredByBridgeDeck = undefined
  }
}
