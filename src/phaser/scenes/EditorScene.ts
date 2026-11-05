import Phaser from 'phaser'
import type { AppCommand, AppSnapshot } from '@/application/appState'
import type { Unsubscribe } from '@/application/eventBus'
import { DEFAULT_TERRAIN_BRUSH_RADIUS } from '@/domain/config'
import {
  renderEditorGrid,
  renderEditorOverlay,
} from '@/phaser/rendering/editorRenderer'
import {
  renderTrackGeometryBase,
  renderTrackGeometryBridgeOverlay,
  renderTrackGeometryStructureUnderlay,
  renderTrackStartGridPreview,
} from '@/phaser/rendering/trackRenderer'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TerrainSurface } from '@/domain/terrain/terrainSurface'
import {
  EditorInputController,
  type EditorCamera,
  type PointerSample,
} from '@/phaser/input/editorInput'
import {
  applyEditorCameraAction,
  fitEditorCamera,
} from '@/phaser/camera/editorCamera'
import { renderTrees } from '@/phaser/rendering/treeRenderer'
import {
  renderTerrain,
  renderTerrainImpactPreview,
  renderTerrainPreview,
} from '@/phaser/rendering/terrainRenderer'
import {
  buildLampPosts,
  renderLampPosts,
} from '@/phaser/rendering/lampPostRenderer'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { terrainBrushKindForMode } from '@/domain/editor/terrainBrush'
import {
  editorPointerRenderChanges,
  editorSnapshotRenderChanges,
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
  private gridGraphics?: Phaser.GameObjects.Graphics
  private terrainGraphics?: Phaser.GameObjects.Graphics
  private sceneryGraphics?: Phaser.GameObjects.Graphics
  private trackGraphics?: Phaser.GameObjects.Graphics
  private structureUnderlayGraphics?: Phaser.GameObjects.Graphics
  private structureDeckGraphics?: Phaser.GameObjects.Graphics
  private structureWallGraphics?: Phaser.GameObjects.Graphics
  private lampGraphics?: Phaser.GameObjects.Graphics
  private terrainPreviewGraphics?: Phaser.GameObjects.Graphics
  private overlayGraphics?: Phaser.GameObjects.Graphics
  private editorInput: EditorInputController | undefined
  private currentSnapshot: AppSnapshot | undefined
  private currentRenderState: EditorRenderState | undefined
  private readonly editorCamera: EditorCamera = { x: 0, y: 0, zoom: 1 }
  private cameraInitialized = false
  private lastCameraRequest = -1
  private previewRenderPending = false
  private compiledTerrainPreviewRevision: number | undefined
  private terrainPreviewImpacts: readonly TerrainPreviewImpact[] = []
  private unsubscribe: Unsubscribe | undefined

  constructor(
    private readonly controller: SceneControllerPort,
    private readonly geometry: TrackGeometryService,
  ) {
    super({ key: 'EditorScene' })
  }

  create(): void {
    this.gridGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.editorGrid)
    this.terrainGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.terrain)
    this.sceneryGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.scenery)
    this.trackGraphics = this.add
      .graphics()
      .setDepth(WORLD_RENDER_DEPTH.road)
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
    this.currentSnapshot = this.controller.snapshot()
    this.editorInput = new EditorInputController({
      camera: this.editorCamera,
      tool: () => this.currentSnapshot?.editorUi.tool ?? 'draw',
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

    this.input.on('pointerdown', this.onPointerDown, this)
    this.input.on('pointermove', this.onPointerMove, this)
    this.input.on('pointerup', this.onPointerUp, this)
    this.input.on('pointerupoutside', this.onPointerUp, this)
    this.input.on('gameout', this.onGameOut, this)
    this.input.on('wheel', this.onWheel, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.dispose, this)
  }

  /** Read-only editor camera telemetry used by development-only gameplay QA. */
  cameraSnapshot(): EditorCamera {
    return { ...this.editorCamera }
  }

  override update(): void {
    if (!this.previewRenderPending) return
    this.previewRenderPending = false
    this.renderTerrainPreviewPresentation()
  }

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    const changes = this.pointerRenderChanges()
    this.editorInput?.pointerDown(this.pointerSample(pointer))
    this.renderChanges(changes)
  }

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!pointer.isDown) return
    const changes = this.pointerRenderChanges()
    this.editorInput?.pointerMove(this.pointerSample(pointer))
    this.renderChanges(changes)
  }

  private readonly onPointerUp = (pointer: Phaser.Input.Pointer): void => {
    const changes = this.pointerRenderChanges()
    this.editorInput?.pointerUp(this.pointerSample(pointer))
    this.renderChanges(changes)
  }

  private readonly onGameOut = (): void => {
    const changes = this.pointerRenderChanges()
    this.editorInput?.cancelActiveGesture()
    this.renderChanges(changes)
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
    this.currentSnapshot = snapshot
    let cameraChanged = false
    const request = snapshot.editorUi.cameraRequest
    if (request && request.sequence !== this.lastCameraRequest) {
      Object.assign(
        this.editorCamera,
        applyEditorCameraAction(
          this.editorCamera,
          request.action,
          snapshot.editor.points,
          this.viewport(),
        ),
      )
      this.lastCameraRequest = request.sequence
      this.cameraInitialized = true
      this.applyCamera()
      cameraChanged = true
    } else if (!this.cameraInitialized && snapshot.editor.points.length > 0) {
      Object.assign(
        this.editorCamera,
        fitEditorCamera(snapshot.editor.points, this.viewport()),
      )
      this.cameraInitialized = true
      this.applyCamera()
      cameraChanged = true
    }
    const renderState = this.editorRenderState(snapshot)
    this.currentRenderState = renderState
    this.renderChanges(
      editorSnapshotRenderChanges(
        previousRenderState,
        renderState,
        cameraChanged,
      ),
    )
  }

  private renderChanges(changes: EditorRenderChanges): void {
    const snapshot = this.currentSnapshot
    if (!snapshot) return
    const night = snapshot.preferences.lighting === 'night'
    this.cameras.main.setBackgroundColor(night ? '#14251b' : '#2d7344')
    const geometry =
      changes.world || changes.overlay
        ? this.trackGeometry()
        : undefined
    if (changes.world && geometry) {
      this.renderWorldPresentation(geometry)
    }
    if (changes.grid) this.renderGridPresentation()
    if (changes.overlay && geometry) {
      this.renderOverlayPresentation(geometry)
    }
    if (changes.preview) this.previewRenderPending = true
  }

  private renderWorldPresentation(geometry: TrackGeometry): void {
    if (
      !this.terrainGraphics ||
      !this.sceneryGraphics ||
      !this.trackGraphics ||
      !this.structureUnderlayGraphics ||
      !this.structureDeckGraphics ||
      !this.structureWallGraphics ||
      !this.lampGraphics ||
      !this.currentSnapshot
    ) {
      return
    }
    const snapshot = this.currentSnapshot
    const night = snapshot.preferences.lighting === 'night'
    this.terrainGraphics.clear()
    this.sceneryGraphics.clear()
    this.trackGraphics.clear()
    this.structureUnderlayGraphics.clear()
    this.structureDeckGraphics.clear()
    this.structureWallGraphics.clear()
    this.lampGraphics.clear()
    renderTerrain(
      this.terrainGraphics,
      geometry.path.terrainSurface,
      night,
    )
    renderTrees(
      this.sceneryGraphics,
      snapshot.editor.trees,
      night,
      geometry.path.terrainSurface,
    )
    renderTrackGeometryBase(
      this.trackGraphics,
      geometry,
      night,
    )
    renderTrackStartGridPreview(this.trackGraphics, geometry)
    renderTrackGeometryStructureUnderlay(
      this.structureUnderlayGraphics,
      geometry,
      night,
    )
    renderTrackGeometryBridgeOverlay(
      this.structureDeckGraphics,
      geometry,
      night,
    )
    renderTrackGeometryBridgeOverlay(
      this.structureWallGraphics,
      geometry,
      night,
      true,
    )
    renderLampPosts(
      this.lampGraphics,
      buildLampPosts(geometry),
      night,
    )
  }

  private renderGridPresentation(): void {
    if (!this.gridGraphics || !this.currentSnapshot) return
    const snapshot = this.currentSnapshot
    const night = snapshot.preferences.lighting === 'night'
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
      )
    }
  }

  private renderTerrainPreviewPresentation(): void {
    if (!this.terrainPreviewGraphics || !this.currentSnapshot) return
    const night = this.currentSnapshot.preferences.lighting === 'night'
    const preview = this.editorInput?.terrainPreview() ?? null
    this.terrainPreviewGraphics.clear()
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
      )
    }
    renderTerrainPreview(
      this.terrainPreviewGraphics,
      preview,
      night,
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
    )
  }

  private editorRenderState(snapshot: AppSnapshot): EditorRenderState {
    return {
      points: snapshot.editor.points,
      terrain: snapshot.editor.terrain,
      trees: snapshot.editor.trees,
      start: snapshot.editor.start,
      night: snapshot.preferences.lighting === 'night',
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
      points: snapshot.editor.points,
      terrain: snapshot.editor.terrain,
      ...(snapshot.editor.start ? { start: snapshot.editor.start } : {}),
    })
  }

  private pointerSample(pointer: Phaser.Input.Pointer): PointerSample {
    return { id: pointer.id, x: pointer.x, y: pointer.y }
  }

  private viewport(): { width: number; height: number } {
    return {
      width: Math.max(1, this.cameras.main.width),
      height: Math.max(1, this.cameras.main.height),
    }
  }

  private applyCamera(): void {
    this.cameras.main.setZoom(this.editorCamera.zoom)
    this.cameras.main.centerOn(this.editorCamera.x, this.editorCamera.y)
  }

  private dispose(): void {
    this.editorInput?.cancelActiveGesture()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.input.off('pointerdown', this.onPointerDown, this)
    this.input.off('pointermove', this.onPointerMove, this)
    this.input.off('pointerup', this.onPointerUp, this)
    this.input.off('pointerupoutside', this.onPointerUp, this)
    this.input.off('gameout', this.onGameOut, this)
    this.input.off('wheel', this.onWheel, this)
    this.editorInput = undefined
    this.currentSnapshot = undefined
    this.currentRenderState = undefined
    this.previewRenderPending = false
    this.compiledTerrainPreviewRevision = undefined
    this.terrainPreviewImpacts = []
  }
}
