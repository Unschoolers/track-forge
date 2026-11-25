import Phaser from 'phaser'
import { normalizeEditorSceneryChoice, type AppCommand, type AppSnapshot } from '@/application/appState'
import type { Unsubscribe } from '@/application/eventBus'
import { DEFAULT_TERRAIN_BRUSH_RADIUS } from '@/domain/config'
import type { TrackId } from '@/domain/model'
import {
  renderEditorGrid,
  renderEditorOverlay,
} from '@/phaser/rendering/editorRenderer'
import {
  renderTrackGeometryBase,
  renderTrackStartGridPreview,
  renderRecoveryCheckpoints,
} from '@/phaser/rendering/trackRenderer'
import {
  renderBridgeDeck,
  renderBridgeSideWalls,
  renderBridgeUnderlay,
} from '@/phaser/rendering/bridgeRenderer'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TerrainSurface } from '@/domain/terrain/terrainSurface'
import { resolveRecoveryCheckpoints } from '@/domain/track/recoveryCheckpoints'
import {
  EditorInputController,
  type EditorCamera,
  type PointerSample,
} from '@/phaser/input/editorInput'
import { applyEditorCameraAction, type EditorViewport } from '@/phaser/camera/editorCamera'
import { renderTrees } from '@/phaser/rendering/treeRenderer'
import {
  renderTerrain,
  renderTerrainImpactPreview,
  renderTerrainPreview,
} from '@/phaser/rendering/terrainRenderer'
import { terrainDetailForView } from '@/phaser/rendering/terrainDetail'
import type { TerrainPresentationDetail } from '@/phaser/rendering/terrainMesh'
import {
  buildLampPosts,
  renderLampPosts,
} from '@/phaser/rendering/lampPostRenderer'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { createMeadowBitmapRenderer, ROAD_MARKINGS_DEPTH, type MeadowBitmapRenderer } from '@/phaser/rendering/meadowBitmapRenderer'
import { GroundTextureRenderer } from '@/phaser/rendering/environmentRenderer'
import { getTrackEnvironment } from '@/presentation/environments'
import { SceneryRenderer } from '@/phaser/rendering/sceneryRenderer'
import { EditorWorldRaster } from '@/phaser/rendering/editorWorldRaster'
import { terrainBrushKindForMode } from '@/domain/editor/terrainBrush'
import {
  editorPointerRenderChanges,
  editorSnapshotRenderChanges,
  editorTreeRenderRequired,
  treePreviewRenderRequired,
  terrainPreviewCompileRequired,
  type EditorRenderChanges,
  type EditorRenderState,
} from '@/phaser/rendering/editorRenderInvalidation'
import {
  buildTerrainPreviewRegions,
  buildTerrainPreviewRoadSegments,
  type TerrainPreviewBounds,
  type TerrainPreviewRoadSegment,
} from '@/phaser/rendering/terrainPreview'

interface TerrainPreviewImpact {
  readonly surface: TerrainSurface
  readonly roadSegments: readonly TerrainPreviewRoadSegment[]
  readonly bounds: TerrainPreviewBounds
}

export interface SceneControllerPort {
  snapshot(): AppSnapshot
  dispatch(command: AppCommand): void
  subscribe(listener: (snapshot: AppSnapshot) => void): Unsubscribe
}

export class EditorScene extends Phaser.Scene {
  private groundRenderer: GroundTextureRenderer | undefined
  private environmentSceneryRenderer: SceneryRenderer | undefined
  private gridGraphics?: Phaser.GameObjects.Graphics
  private terrainGraphics?: Phaser.GameObjects.Graphics
  private sceneryGraphics?: Phaser.GameObjects.Graphics
  private trackGraphics?: Phaser.GameObjects.Graphics
  private roadMarkingGraphics?: Phaser.GameObjects.Graphics
  private meadowBitmapRenderer: MeadowBitmapRenderer | undefined
  private structureUnderlayGraphics?: Phaser.GameObjects.Graphics
  private structureDeckGraphics?: Phaser.GameObjects.Graphics
  private structureWallGraphics?: Phaser.GameObjects.Graphics
  private lampGraphics?: Phaser.GameObjects.Graphics
  private terrainPreviewGraphics?: Phaser.GameObjects.Graphics
  private overlayGraphics?: Phaser.GameObjects.Graphics
  private editorInput: EditorInputController | undefined
  private pointerListeners: AbortController | undefined
  private currentSnapshot: AppSnapshot | undefined
  private currentRenderState: EditorRenderState | undefined
  private readonly editorCamera: EditorCamera = { x: 0, y: 0, zoom: 1 }
  private cameraTrackId: TrackId | undefined
  private lastCameraRequest = -1
  private worldRenderPending = false
  private overlayRenderPending = false
  private lastOverlayZoom = 0
  private previewRenderPending = false
  private compiledTerrainPreviewRevision: number | undefined
  private terrainPreviewImpacts: readonly TerrainPreviewImpact[] = []
  private renderedTerrainDetail: TerrainPresentationDetail | undefined
  private terrainRaster: EditorWorldRaster | undefined
  private roadRaster: EditorWorldRaster | undefined
  private bitmapRoadRaster: EditorWorldRaster | undefined
  private bitmapMarkingRaster: EditorWorldRaster | undefined
  private rasterizeWorld = false
  private unsubscribe: Unsubscribe | undefined

  constructor(
    private readonly controller: SceneControllerPort,
    private readonly geometry: TrackGeometryService,
  ) {
    super({ key: 'EditorScene' })
  }

  create(): void {
    this.groundRenderer = new GroundTextureRenderer(this)
    this.gridGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.editorGrid)
    this.terrainGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.terrain)
    this.environmentSceneryRenderer = new SceneryRenderer(this.add.graphics().setDepth(WORLD_RENDER_DEPTH.environmentScenery))
    this.sceneryGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.scenery)
    this.trackGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.road)
    this.roadMarkingGraphics = this.add.graphics().setDepth(ROAD_MARKINGS_DEPTH)
    this.structureUnderlayGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.structureUnderlay)
    this.structureDeckGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.structureDeck)
    this.structureWallGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.structureWall)
    this.lampGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.lamp)
    this.terrainPreviewGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.terrainPreview)
    this.overlayGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.editorOverlay)
    this.terrainRaster = new EditorWorldRaster(this, [this.terrainGraphics], WORLD_RENDER_DEPTH.terrain)
    const decorations = [this.roadMarkingGraphics, this.structureUnderlayGraphics,
      this.structureDeckGraphics, this.structureWallGraphics, this.lampGraphics]
    this.roadRaster = new EditorWorldRaster(this, [this.trackGraphics, ...decorations], WORLD_RENDER_DEPTH.road)
    // Meadow bitmap sprites sit between the road base and markings. Separate
    // captures preserve painter order even on very large editor tracks.
    this.bitmapRoadRaster = new EditorWorldRaster(this, [this.trackGraphics], WORLD_RENDER_DEPTH.road)
    this.bitmapMarkingRaster = new EditorWorldRaster(this, decorations, ROAD_MARKINGS_DEPTH)
    this.currentSnapshot = this.controller.snapshot()
    this.editorInput = new EditorInputController({
      camera: this.editorCamera,
      tool: () => this.currentSnapshot?.editorUi.tool ?? 'draw',
      sceneryChoice: () => normalizeEditorSceneryChoice(this.currentSnapshot?.editorUi.sceneryChoice, this.currentSnapshot?.editor.environmentId ?? 'grass'),
      surface: () => this.currentSnapshot?.editorUi.surface ?? 'street',
      structure: () =>
        this.currentSnapshot?.editorUi.structure ?? 'overpass',
      terrainBrush: () =>
        this.currentSnapshot
          ? {
              kind: terrainBrushKindForMode(
                this.currentSnapshot.editorUi.terrainBrush.mode,
              ),
              radius: this.currentSnapshot.editorUi.terrainBrush.radius,
            }
          : {
              kind: 'hill' as const,
              radius: DEFAULT_TERRAIN_BRUSH_RADIUS,
            },
      editor: () =>
        this.currentSnapshot?.editor ?? this.controller.snapshot().editor,
      path: () => this.trackGeometry().path,
      worldPoint: (pointer) => {
        const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
        return { x: point.x, y: point.y }
      },
      dispatch: (command) =>
        this.controller.dispatch({ type: 'editor', command }),
      viewport: () => this.viewport(),
      onCameraChanged: () => {
        this.applyCamera()
        if (this.lastOverlayZoom !== this.editorCamera.zoom) this.overlayRenderPending = true
        this.refreshTerrainForCamera()
        this.renderGridPresentation()
      },
      onCrossingSelected: (key) =>
        this.controller.dispatch({
          type: 'select-editor-crossing',
          key,
        }),
      onPointSelected: (index) =>
        this.controller.dispatch({
          type: 'select-editor-point',
          index,
        }),
      onRejected: (rejection) =>
        this.controller.dispatch({
          type: 'report-editor-rejection',
          rejection,
        }),
    })
    this.renderSnapshot(this.currentSnapshot)
    this.unsubscribe = this.controller.subscribe((snapshot) =>
      this.renderSnapshot(snapshot),
    )

    this.pointerListeners = new AbortController()
    const { signal } = this.pointerListeners
    // Canvas gestures need capture across the HTML controls. Phaser's touch
    // hit test stops delivering moves as soon as a finger covers a button.
    const canvas = this.game.canvas
    canvas.addEventListener('pointerdown', this.onPointerEvent, { signal })
    canvas.addEventListener('pointermove', this.onPointerEvent, { signal })
    canvas.addEventListener('pointerup', this.onPointerEvent, { signal })
    canvas.addEventListener('pointercancel', this.onPointerEvent, { signal })
    canvas.addEventListener('lostpointercapture', this.onPointerEvent, { signal })
    window.addEventListener('blur', this.cancelPointerGesture, { signal })
    this.input.on('wheel', this.onWheel, this)
    this.game.renderer?.on(Phaser.Renderer.Events.RESTORE_WEBGL, this.invalidateRasters)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.dispose, this)
  }

  /** Read-only editor camera telemetry used by development-only gameplay QA. */
  cameraSnapshot(): EditorCamera {
    const camera = this.cameras.main
    return {
      x: camera.scrollX + camera.width / 2,
      y: camera.scrollY + camera.height / 2,
      zoom: camera.zoom,
    }
  }

  override update(): void {
    this.renderPendingGeometry()
    const { width, height } = this.viewport()
    this.terrainRaster?.render(this.editorCamera, width, height, this.rasterizeWorld)
    if (this.meadowBitmapRenderer) {
      this.roadRaster?.render(this.editorCamera, width, height, false)
      this.bitmapRoadRaster?.render(this.editorCamera, width, height, this.rasterizeWorld)
      this.bitmapMarkingRaster?.render(this.editorCamera, width, height, this.rasterizeWorld)
      this.meadowBitmapRenderer.render({
        centerX: this.editorCamera.x, centerY: this.editorCamera.y,
        width, height, zoom: this.editorCamera.zoom, rotation: 0,
      })
    } else {
      this.bitmapRoadRaster?.render(this.editorCamera, width, height, false)
      this.bitmapMarkingRaster?.render(this.editorCamera, width, height, false)
      this.roadRaster?.render(this.editorCamera, width, height, this.rasterizeWorld)
    }
    this.renderGroundPresentation()
    this.renderSceneryPresentation()
    if (!this.previewRenderPending) return
    this.previewRenderPending = false
    this.renderTerrainPreviewPresentation()
  }

  private readonly onPointerEvent = (event: PointerEvent): void => {
    const input = this.editorInput
    if (!input) return
    const canvas = this.game.canvas
    if (event.type === 'pointerdown') {
      if (event.button !== 0) return
      canvas.setPointerCapture(event.pointerId)
    } else if (event.type === 'pointermove' && !canvas.hasPointerCapture(event.pointerId)) {
      return
    }

    const changes = this.pointerRenderChanges()
    const previousPreview = input.sceneryPreview()
    switch (event.type) {
      case 'pointerdown':
        input.pointerDown(this.pointerSample(event))
        break
      case 'pointermove':
        if (!input.navigationActive() && document.elementFromPoint(event.clientX, event.clientY) !== canvas) {
          input.cancelActiveGesture()
        } else {
          input.pointerMove(this.pointerSample(event))
        }
        break
      case 'pointerup':
        input.pointerUp(this.pointerSample(event))
        break
      case 'pointercancel':
      case 'lostpointercapture':
        input.pointerCancel(event.pointerId)
        break
    }
    this.renderChanges(changes)
    this.refreshTreePreview(previousPreview)
  }

  private readonly cancelPointerGesture = (): void => {
    const changes = this.pointerRenderChanges()
    const previousPreview = this.editorInput?.sceneryPreview() ?? null
    this.editorInput?.cancelActiveGesture()
    this.renderChanges(changes)
    this.refreshTreePreview(previousPreview)
  }

  private readonly onWheel = (
    _pointer: Phaser.Input.Pointer,
    _objects: readonly Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ): void => {
    const multiplier = deltaY < 0 ? 1.12 : 1 / 1.12
    this.editorInput?.zoomBy(
      this.editorCamera.zoom * multiplier - this.editorCamera.zoom,
    )
  }

  private renderSnapshot(snapshot: AppSnapshot): void {
    const previousRenderState = this.currentRenderState
    const oldSnapshot = this.currentSnapshot
    const previousPreview = this.editorInput?.sceneryPreview() ?? null
    this.currentSnapshot = snapshot
    const gestureContextChanged = oldSnapshot && (oldSnapshot.currentTrack?.id !== snapshot.currentTrack?.id || oldSnapshot.editorUi.tool !== snapshot.editorUi.tool || oldSnapshot.editorUi.sceneryChoice !== snapshot.editorUi.sceneryChoice || oldSnapshot.editor.environmentId !== snapshot.editor.environmentId)
    if (gestureContextChanged) {
      this.editorInput?.cancelActiveGesture()
    }
    const trackId = snapshot.currentTrack?.id
    const trackChanged = trackId !== this.cameraTrackId
    const request = snapshot.editorUi.cameraRequest
    const requestedAction = request && request.sequence !== this.lastCameraRequest ? request.action : undefined
    const cameraAction = trackChanged ? 'fit' : requestedAction
    this.cameraTrackId = trackId
    this.lastCameraRequest = request?.sequence ?? -1
    if (cameraAction) {
      const framingRoad = cameraAction !== 'zoom-in'
      const path = framingRoad ? this.trackGeometry().path.points : []
      Object.assign(
        this.editorCamera,
        applyEditorCameraAction(
          this.editorCamera,
          cameraAction,
          path.length ? path : snapshot.editor.points,
          framingRoad ? this.fitViewport() : this.viewport(),
        ),
      )
    }
    const cameraChanged = cameraAction !== undefined
    // Phaser creates a new camera each time the scene starts.
    if (cameraChanged || !previousRenderState) this.applyCamera()
    const renderState = this.editorRenderState(snapshot)
    this.currentRenderState = renderState
    const changes = editorSnapshotRenderChanges(
      previousRenderState,
      renderState,
      cameraChanged,
    )
    this.renderChanges(changes)
    if (editorTreeRenderRequired(previousRenderState, renderState) ||
      (gestureContextChanged && treePreviewRenderRequired(previousPreview, this.editorInput?.sceneryPreview() ?? null))) {
      this.renderSceneryPresentation(true)
    }
    if (previousRenderState && previousRenderState.environmentId !== renderState.environmentId && !this.worldRenderPending) this.renderTerrainPresentation(this.trackGeometry())
    if (cameraChanged && !changes.world) this.refreshTerrainForCamera()
  }

  private renderChanges(changes: EditorRenderChanges): void {
    const snapshot = this.currentSnapshot
    if (!snapshot) return
    const night = snapshot.currentTrack?.lighting === 'night'
    this.cameras.main.setBackgroundColor(
      (night ? getTrackEnvironment(snapshot.editor.environmentId).night : getTrackEnvironment(snapshot.editor.environmentId).day).editorGround,
    )
    this.renderGroundPresentation()
    // A touch release can append, simplify and close a stroke in one frame.
    this.worldRenderPending ||= changes.world
    this.overlayRenderPending ||= changes.overlay
    if (changes.appearance || changes.world) this.renderSceneryPresentation()
    if (changes.grid) this.renderGridPresentation()
    if (changes.preview) this.previewRenderPending = true
  }

  private renderPendingGeometry(): void {
    if (!this.worldRenderPending && !this.overlayRenderPending) return
    const geometry = this.trackGeometry()
    if (this.worldRenderPending) {
      this.worldRenderPending = false
      this.renderWorldPresentation(geometry)
    }
    if (this.overlayRenderPending) {
      this.overlayRenderPending = false
      this.renderOverlayPresentation(geometry)
    }
  }

  private renderWorldPresentation(geometry: TrackGeometry): void {
    if (
      !this.terrainGraphics ||
      !this.sceneryGraphics ||
      !this.trackGraphics ||
      !this.roadMarkingGraphics ||
      !this.structureUnderlayGraphics ||
      !this.structureDeckGraphics ||
      !this.structureWallGraphics ||
      !this.lampGraphics ||
      !this.currentSnapshot
    ) {
      return
    }
    const snapshot = this.currentSnapshot
    const night = snapshot.currentTrack?.lighting === 'night'
    this.rasterizeWorld = (geometry.path.terrainSurface.authoredCellCount ?? 0) >= 1_600 ||
      geometry.path.points.length >= 2_200
    this.trackGraphics.clear()
    this.roadMarkingGraphics.clear()
    this.meadowBitmapRenderer?.destroy()
    // The inexpensive vector geometry remains visible during a live gesture;
    // bake the new bitmap window only when the geometry is committed.
    this.meadowBitmapRenderer = snapshot.editor.gestureStart ? undefined : createMeadowBitmapRenderer(this, geometry, night, snapshot.editor.environmentId)
    this.structureUnderlayGraphics.clear()
    this.structureDeckGraphics.clear()
    this.structureWallGraphics.clear()
    this.lampGraphics.clear()
    this.renderTerrainPresentation(geometry)
    renderTrackGeometryBase(
      this.trackGraphics,
      geometry,
      night,
      snapshot.editor.environmentId,
      this.roadMarkingGraphics,
    )
    renderTrackStartGridPreview(this.roadMarkingGraphics, geometry)
    renderBridgeUnderlay(
      this.structureUnderlayGraphics,
      geometry,
      night,
      'local-ground',
    )
    renderBridgeDeck(
      this.structureDeckGraphics,
      geometry,
      night,
      'local-ground',
    )
    renderBridgeSideWalls(
      this.structureWallGraphics,
      geometry,
      night,
      'local-ground',
    )
    renderLampPosts(
      this.lampGraphics,
      buildLampPosts(geometry, 'local-ground'),
      night,
    )
    this.roadRaster?.invalidate()
    this.bitmapRoadRaster?.invalidate()
    this.bitmapMarkingRaster?.invalidate()
  }

  private refreshTreePreview(previous: ReturnType<EditorInputController['sceneryPreview']>): void {
    if (treePreviewRenderRequired(previous, this.editorInput?.sceneryPreview() ?? null)) {
      this.renderSceneryPresentation(true)
    }
  }

  private renderTerrainPresentation(geometry: TrackGeometry): void {
    if (!this.terrainGraphics || !this.currentSnapshot) return
    const snapshot = this.currentSnapshot
    const night = snapshot.currentTrack?.lighting === 'night'
    const environment = getTrackEnvironment(snapshot.editor.environmentId)
    const detail = this.terrainDetail(geometry)
    this.terrainGraphics.clear()
    renderTerrain(this.terrainGraphics, geometry.path.terrainSurface, night, detail, night ? environment.night : environment.day)
    this.renderedTerrainDetail = detail
    this.terrainRaster?.invalidate()
  }

  private renderSceneryPresentation(renderTreesLayer = false): void {
    const snapshot = this.currentSnapshot
    if (!snapshot) return
    const camera = this.cameras.main
    const preview = this.editorInput?.sceneryPreview() ?? null
    this.environmentSceneryRenderer?.render({ centerX: camera.scrollX + camera.width / 2, centerY: camera.scrollY + camera.height / 2, width: camera.width, height: camera.height, zoom: camera.zoom, rotation: 0 }, snapshot.editor.environmentId, snapshot.editor.scenery, snapshot.currentTrack?.lighting === 'night', preview?.type === 'prop' ? preview : undefined)
    if (!renderTreesLayer || !this.sceneryGraphics) return
    this.sceneryGraphics.clear()
    const trees = preview?.type === 'tree' ? snapshot.editor.trees.map((tree, index) => index === preview.index ? preview.position : tree) : snapshot.editor.trees
    renderTrees(this.sceneryGraphics, trees, snapshot.currentTrack?.lighting === 'night', this.trackGeometry().path.terrainSurface, snapshot.editor.environmentId)
  }

  private terrainDetail(geometry: TrackGeometry): TerrainPresentationDetail {
    return terrainDetailForView(
      geometry.path.terrainSurface.authoredCellCount,
      this.editorCamera.zoom,
    )
  }

  /** Zooming only rebuilds terrain when crossing a detail threshold.
   * Road, bridges, and authored geometry stay exactly as they were. */
  private refreshTerrainForCamera(): void {
    if (!this.terrainGraphics || !this.currentSnapshot || this.worldRenderPending) return
    const geometry = this.trackGeometry()
    const detail = this.terrainDetail(geometry)
    if (detail === this.renderedTerrainDetail) return
    this.renderTerrainPresentation(geometry)
  }

  private renderGroundPresentation(): void {
    if (!this.currentSnapshot) return
    const camera = this.cameras.main
    this.groundRenderer?.render(
      {
        centerX: camera.scrollX + camera.width / 2,
        centerY: camera.scrollY + camera.height / 2,
        width: camera.width,
        height: camera.height,
        zoom: camera.zoom,
        rotation: 0,
      },
      this.currentSnapshot.currentTrack?.lighting === 'night',
      this.currentSnapshot.editor.environmentId,
    )
  }

  private renderGridPresentation(): void {
    if (!this.gridGraphics || !this.currentSnapshot) return
    const snapshot = this.currentSnapshot
    const night = snapshot.currentTrack?.lighting === 'night'
    this.gridGraphics.clear()
    if (snapshot.editorUi.grid) {
      const halfWidth = this.cameras.main.width / (2 * this.editorCamera.zoom)
      const halfHeight =
        this.cameras.main.height / (2 * this.editorCamera.zoom)
      renderEditorGrid(
        this.gridGraphics,
        {
          left: this.editorCamera.x - halfWidth,
          top: this.editorCamera.y - halfHeight,
          right: this.editorCamera.x + halfWidth,
          bottom: this.editorCamera.y + halfHeight,
        },
        night,
        this.editorCamera.zoom,
      )
    }
  }

  private renderTerrainPreviewPresentation(): void {
    if (!this.terrainPreviewGraphics || !this.currentSnapshot) return
    const night = this.currentSnapshot.currentTrack?.lighting === 'night'
    const environment = getTrackEnvironment(this.currentSnapshot.editor.environmentId)
    const palette = night ? environment.night : environment.day
    this.terrainPreviewGraphics.clear()
    if (terrainDetailForView(this.currentSnapshot.editor.terrain.cells.length, this.editorCamera.zoom) === 'overview') {
      this.compiledTerrainPreviewRevision = undefined
      this.terrainPreviewImpacts = []
      renderTerrainPreview(this.terrainPreviewGraphics, this.editorInput?.terrainCellPreview() ?? null, night, palette)
      return
    }
    const preview = this.editorInput?.terrainPreview() ?? null
    if (!preview) {
      this.compiledTerrainPreviewRevision = undefined
      this.terrainPreviewImpacts = []
      return
    }
    if (
      terrainPreviewCompileRequired(
        this.compiledTerrainPreviewRevision,
        preview,
      )
    ) {
      const committed = this.trackGeometry().path
      const snapshot = this.currentSnapshot
      this.terrainPreviewImpacts = buildTerrainPreviewRegions(preview).map(
        (region): TerrainPreviewImpact => {
          const candidate = this.geometry.get({
            routeKind: snapshot.editor.routeKind,
            points: snapshot.editor.points,
            terrain: region.terrain,
            ...(snapshot.editor.start
              ? { start: snapshot.editor.start }
              : {}),
          }).path
          return {
            surface: candidate.terrainSurface,
            bounds: region.bounds,
            roadSegments: buildTerrainPreviewRoadSegments(
              committed,
              candidate,
              region.bounds,
            ),
          }
        },
      )
      this.compiledTerrainPreviewRevision = preview.revision
    }
    for (const impact of this.terrainPreviewImpacts) {
      renderTerrainImpactPreview(
        this.terrainPreviewGraphics,
        impact.surface,
        impact.roadSegments,
        night,
        impact.bounds,
        palette,
      )
    }
    renderTerrainPreview(
      this.terrainPreviewGraphics,
      preview,
      night,
      palette,
    )
  }

  private renderOverlayPresentation(geometry: TrackGeometry): void {
    if (!this.overlayGraphics || !this.currentSnapshot) return
    const snapshot = this.currentSnapshot
    this.overlayGraphics.clear()
    renderEditorOverlay(
      this.overlayGraphics,
      snapshot.editor,
      geometry,
      snapshot.editorUi.selectedPoint ?? undefined,
      snapshot.editorUi.selectedCrossing,
      this.editorCamera.zoom,
    )
    this.lastOverlayZoom = this.editorCamera.zoom
    renderRecoveryCheckpoints(
      this.overlayGraphics, geometry.path,
      resolveRecoveryCheckpoints(geometry.path, snapshot.editor.recoveryCheckpoints),
      this.editorCamera.zoom,
    )
  }

  private editorRenderState(snapshot: AppSnapshot): EditorRenderState {
    return {
      routeKind: snapshot.editor.routeKind,
      points: snapshot.editor.points,
      terrain: snapshot.editor.terrain,
      trees: snapshot.editor.trees,
      scenery: snapshot.editor.scenery,
      recoveryCheckpoints: snapshot.editor.recoveryCheckpoints,
      environmentId: snapshot.editor.environmentId,
      start: snapshot.editor.start,
      night: snapshot.currentTrack?.lighting === 'night',
      grid: snapshot.editorUi.grid,
      selectedPoint: snapshot.editorUi.selectedPoint,
      selectedCrossing: snapshot.editorUi.selectedCrossing,
      tool: snapshot.editorUi.tool,
      terrainMode: snapshot.editorUi.terrainBrush.mode,
      terrainRadius: snapshot.editorUi.terrainBrush.radius,
    }
  }

  private pointerRenderChanges(): EditorRenderChanges {
    return editorPointerRenderChanges(
      this.currentSnapshot?.editorUi.tool ?? 'draw',
    )
  }

  private trackGeometry() {
    const snapshot = this.currentSnapshot ?? this.controller.snapshot()
    return this.geometry.get({
      routeKind: snapshot.editor.routeKind,
      points: snapshot.editor.points,
      terrain: snapshot.editor.terrain,
      ...(snapshot.editor.start ? { start: snapshot.editor.start } : {}),
    })
  }

  private pointerSample(event: PointerEvent): PointerSample {
    return {
      id: event.pointerId,
      x: this.scale.transformX(event.pageX),
      y: this.scale.transformY(event.pageY),
    }
  }

  private viewport(): EditorViewport {
    return {
      width: Math.max(1, this.cameras.main.width),
      height: Math.max(1, this.cameras.main.height),
    }
  }

  private fitViewport(): EditorViewport {
    const viewport = this.viewport()
    const editor = document.querySelector('[data-screen="editor"]')
    const canvas = this.game.canvas.getBoundingClientRect()
    if (!editor || canvas.width === 0 || canvas.height === 0) return viewport

    const controls = editor.querySelectorAll(
      '.topbar, .tool-rail, .history-actions, .status-pill, .editor-context-dock, .editor-actions, ' +
      '.diagnostic-panel, .crossing-control, .point-control, .start-control',
    )
    const margin = 4
    const scaleX = viewport.width / canvas.width
    const scaleY = viewport.height / canvas.height
    const coveredAreas = Array.from(controls, control => control.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0)
      .map(rect => ({
        left: (rect.left - canvas.left - margin) * scaleX,
        right: (rect.right - canvas.left + margin) * scaleX,
        top: (rect.top - canvas.top - margin) * scaleY,
        bottom: (rect.bottom - canvas.top + margin) * scaleY,
      }))
    return { ...viewport, coveredAreas }
  }

  private applyCamera(): void {
    this.cameras.main.setZoom(this.editorCamera.zoom)
    this.cameras.main.centerOn(this.editorCamera.x, this.editorCamera.y)
  }

  private readonly invalidateRasters = (): void => {
    this.terrainRaster?.invalidate()
    this.roadRaster?.invalidate()
    this.bitmapRoadRaster?.invalidate()
    this.bitmapMarkingRaster?.invalidate()
  }

  private dispose(): void {
    this.pointerListeners?.abort()
    this.pointerListeners = undefined
    this.editorInput?.cancelActiveGesture()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.input.off('wheel', this.onWheel, this)
    this.game.renderer?.off(Phaser.Renderer.Events.RESTORE_WEBGL, this.invalidateRasters)
    this.groundRenderer = undefined
    this.environmentSceneryRenderer?.destroy()
    this.environmentSceneryRenderer = undefined
    this.editorInput = undefined
    this.currentSnapshot = undefined
    this.currentRenderState = undefined
    this.worldRenderPending = false
    this.overlayRenderPending = false
    this.previewRenderPending = false
    this.compiledTerrainPreviewRevision = undefined
    this.terrainPreviewImpacts = []
    this.renderedTerrainDetail = undefined
    this.terrainRaster = undefined
    this.roadRaster = undefined
    this.bitmapRoadRaster = undefined
    this.bitmapMarkingRaster = undefined
    this.meadowBitmapRenderer?.destroy()
    this.meadowBitmapRenderer = undefined
    this.rasterizeWorld = false
  }
}
