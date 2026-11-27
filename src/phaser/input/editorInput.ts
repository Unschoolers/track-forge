import type { EditorCommand } from '@/domain/editor/editorState'
import type { EditorState } from '@/domain/editor/editorState'
import type { EditorSceneryChoice } from '@/application/appState'
import { isSceneryPosition, sceneryKindBelongsToEnvironment } from '@/domain/track/trackEnvironment'
import { getTrackEnvironment } from '@/presentation/environments'
import {
  DEFAULT_TERRAIN_BRUSH_RADIUS,
  ROAD_GEOMETRY,
  TERRAIN_LIMITS,
  type TerrainBrushRadius,
} from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import { EDITOR_ZOOM_LIMITS, minimumEditorZoomOut } from '@/phaser/camera/editorCamera'
import type {
  RoadStructure,
  TerrainBrushKind,
  TrackPoint,
  Vector2,
} from '@/domain/model'
import {
  appendDrawPoint,
  nearestControlPoint,
  nearestCheckpointMarker,
  nearestSegmentIndex,
  planPointInsertion,
  nearestTree,
  surfaceForIndex,
  type EditorSurface,
  type EditorTool,
} from '@/domain/editor/editorGeometry'
import {
  nearestPathPoint,
  type RoadPath,
} from '@/domain/track/pathBuilder'
import { isSafeRoadRecoverySample } from '@/domain/track/waterExposure'
import {
  EMPTY_TERRAIN,
  planTerrainCellsInBrush,
  terrainCellKey,
  type TerrainCellCoordinate,
} from '@/domain/terrain/terrainField'
import type { TerrainCell, TerrainMap } from '@/domain/model'
import {
  TERRAIN_CAPACITY_REJECTION,
  TERRAIN_COORDINATE_BOUNDS_REJECTION,
  INVALID_SCENERY_POSITION_REJECTION,
  treePlacementRejection,
  type EditorCommandRejection,
} from '@/domain/editor/editorConstraints'

export type { EditorTool } from '@/domain/editor/editorGeometry'

const SELECTION_DRAG_SCREEN_PIXELS = 8

function terrainWithStroke(
  base: TerrainMap,
  changedCells: readonly TerrainCellCoordinate[],
  kind: TerrainBrushKind,
): TerrainMap {
  if (changedCells.length === 0) return base
  const changed = changedCells
  const cells: TerrainCell[] = []
  let baseIndex = 0
  let changedIndex = 0
  while (baseIndex < base.cells.length || changedIndex < changed.length) {
    const original = base.cells[baseIndex]
    const replacement = changed[changedIndex]
    if (!replacement) {
      if (original) cells.push(original)
      baseIndex += 1
      continue
    }
    if (!original) {
      if (kind !== 'ground') cells.push({ ...replacement, kind })
      changedIndex += 1
      continue
    }
    const order =
      original.row - replacement.row || original.column - replacement.column
    if (order < 0) {
      cells.push(original)
      baseIndex += 1
    } else if (order > 0) {
      if (kind !== 'ground') cells.push({ ...replacement, kind })
      changedIndex += 1
    } else {
      if (kind !== 'ground') cells.push({ ...replacement, kind })
      baseIndex += 1
      changedIndex += 1
    }
  }
  return cells.length === 0 ? EMPTY_TERRAIN : { cellSize: base.cellSize, cells }
}

export interface EditorCamera {
  x: number
  y: number
  zoom: number
}

export interface PointerSample {
  readonly id: number
  readonly x: number
  readonly y: number
}

export interface TerrainBrush {
  readonly kind: TerrainBrushKind
  readonly radius: TerrainBrushRadius
}

export interface TerrainPreview {
  readonly revision: number
  readonly position: Vector2
  readonly radius: TerrainBrushRadius
  readonly cells: readonly TerrainCellCoordinate[]
  readonly dirtyCells: readonly TerrainCellCoordinate[]
  readonly kind: TerrainBrushKind
  readonly terrain: TerrainMap
}

export type TerrainCellPreview = Omit<TerrainPreview, 'terrain'>
type TerrainPreviewDraft = Omit<TerrainCellPreview, 'cells'>

interface SceneryGesture {
  readonly type: 'tree' | 'prop' | 'empty'
  readonly index: number
  readonly source: Vector2 | undefined
  readonly environmentId: EditorState['environmentId']
  readonly choice: EditorSceneryChoice
  readonly start: Vector2
  readonly offset: Vector2
  position: Vector2
  dragging: boolean
}

interface SceneryHit {
  readonly type: 'tree' | 'prop'
  readonly index: number
  readonly source: Vector2
  readonly distance: number
}

export interface EditorInputDependencies {
  readonly camera: EditorCamera
  readonly tool: () => EditorTool
  readonly surface: () => EditorSurface
  readonly structure?: () => RoadStructure
  readonly terrainBrush?: () => TerrainBrush
  readonly sceneryChoice?: () => EditorSceneryChoice
  readonly editor: () => EditorState
  readonly path?: () => RoadPath
  readonly dispatch: (command: EditorCommand) => void
  readonly worldPoint?: (pointer: PointerSample) => Vector2
  readonly polygonContains?: (point: Vector2, polygon: readonly Vector2[]) => boolean
  readonly onCameraChanged?: () => void
  readonly viewport?: () => { readonly width: number; readonly height: number }
  readonly onCrossingSelected?: (key: string | null) => void
  readonly onPointSelected?: (index: number | null) => void
  readonly onRejected?: (rejection: EditorCommandRejection) => void
}

function pointInPolygon(
  point: Vector2,
  polygon: readonly Vector2[],
): boolean {
  let inside = false
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    if (!currentPoint || !previousPoint) continue
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) *
          (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x
    if (intersects) inside = !inside
  }
  return inside
}

export class EditorInputController {
  private activePointer: number | undefined
  private gestureTool: EditorTool | undefined
  private gestureHasTransaction = false
  private readonly pointers = new Map<number, PointerSample>()
  private navigating = false
  private navAnchor: { center: Vector2; distance: number } | undefined
  private lastScreen: Vector2 | undefined
  private selectedPoint = -1
  private selectionStart: PointerSample | undefined
  private selectionPoints: readonly TrackPoint[] | undefined
  private roadPreview: { readonly index: number; readonly position: Vector2 } | undefined
  private checkpointGesture: { start: PointerSample; mark: number | undefined; dragging: boolean } | undefined
  private drawStartIndex = 0
  private pendingDrawStart: { screen: Vector2; world: Vector2 } | undefined
  private sceneryGesture: SceneryGesture | undefined
  private terrainPreviewRevision = 0
  private terrainStroke: {
    readonly kind: TerrainBrushKind
    readonly radius: TerrainBrushRadius
    readonly baseTerrain: TerrainMap
    readonly baseKindsByKey: ReadonlyMap<string, 'hill' | 'water'>
    readonly cellsByKey: Map<string, TerrainCellCoordinate>
    candidateCellCount: number
    lastWorld: Vector2 | undefined
    revision: number
    rejected: boolean
    materialized:
      | {
          readonly revision: number
          readonly cells: readonly TerrainCellCoordinate[]
          readonly terrain: TerrainMap
        }
      | undefined
    preview: TerrainPreviewDraft | undefined
  } | undefined

  constructor(private readonly dependencies: EditorInputDependencies) {}

  pointerDown(pointer: PointerSample): void {
    this.pointers.set(pointer.id, pointer)
    if (this.pointers.size >= 2) {
      if (!this.navigating && this.activePointer !== undefined) {
        this.abortGesture()
      }
      this.navigating = true
      this.navAnchor = this.pinchSample()
      return
    }
    if (this.navigating || this.activePointer !== undefined) return
    this.activePointer = pointer.id
    this.gestureTool = this.dependencies.tool()
    this.selectionStart = this.gestureTool === 'select' ? pointer : undefined
    this.selectionPoints = undefined
    this.roadPreview = undefined
    this.lastScreen = pointer
    this.drawStartIndex = this.dependencies.editor().points.length
    this.gestureHasTransaction = this.gestureTool !== 'pan' &&
      !(this.gestureTool === 'tree' && this.dependencies.sceneryChoice)
    if (this.gestureHasTransaction) {
      this.dependencies.dispatch({ type: 'begin-gesture' })
    }
    if (this.gestureTool === 'draw') {
      // Wait for a stroke or tap so a pinch can start without rebuilding the road.
      this.pendingDrawStart = { screen: pointer, world: this.worldPosition(pointer) }
    } else {
      this.applyTool(pointer, 'down')
    }
  }

  pointerMove(pointer: PointerSample): void {
    if (!this.pointers.has(pointer.id)) return
    this.pointers.set(pointer.id, pointer)
    if (this.navigating) {
      const next = this.pinchSample()
      const previous = this.navAnchor
      if (next && previous) {
        const camera = this.dependencies.camera
        const viewport = this.dependencies.viewport?.() ?? { width: 0, height: 0 }
        const oldZoom = camera.zoom
        const zoom = clamp(oldZoom * next.distance / previous.distance, minimumEditorZoomOut(oldZoom, viewport), EDITOR_ZOOM_LIMITS.maximum)
        const worldX = camera.x + (previous.center.x - viewport.width / 2) / oldZoom
        const worldY = camera.y + (previous.center.y - viewport.height / 2) / oldZoom
        camera.zoom = zoom
        camera.x = worldX - (next.center.x - viewport.width / 2) / zoom
        camera.y = worldY - (next.center.y - viewport.height / 2) / zoom
        this.dependencies.onCameraChanged?.()
      }
      this.navAnchor = next
      return
    }
    if (pointer.id !== this.activePointer) return
    if (this.gestureTool !== this.dependencies.tool()) {
      this.abortGesture()
      return
    }
    const previous = this.lastScreen
    if (this.dependencies.tool() === 'pan' && previous) {
      this.dependencies.camera.x -=
        (pointer.x - previous.x) / this.dependencies.camera.zoom
      this.dependencies.camera.y -=
        (pointer.y - previous.y) / this.dependencies.camera.zoom
      this.dependencies.onCameraChanged?.()
    } else {
      const start = this.pendingDrawStart
      if (start && Math.hypot(pointer.x - start.screen.x, pointer.y - start.screen.y) < 4) return
      if (this.gestureTool === 'select' && this.selectedPoint >= 0 && !this.roadPreview) {
        const origin = this.selectionStart
        if (origin && Math.hypot(pointer.x - origin.x, pointer.y - origin.y) < SELECTION_DRAG_SCREEN_PIXELS) return
      }
      this.commitPendingDrawStart()
      this.applyTool(pointer, 'move')
    }
    this.lastScreen = pointer
  }

  pointerUp(pointer: PointerSample): void {
    if (pointer.id === this.activePointer && this.sceneryGesture) {
      this.updateSceneryGesture(pointer)
    }
    if (pointer.id === this.activePointer && this.gestureTool === 'checkpoint' && !this.navigating) {
      this.finishCheckpointGesture(pointer)
    }
    if (pointer.id === this.activePointer && this.gestureTool === 'select' && !this.navigating) {
      const preview = this.roadPointPreview()
      this.roadPreview = undefined
      if (preview && this.dependencies.tool() === 'select') {
        const position = this.worldPosition(pointer)
        const original = this.selectionPoints?.[preview.index]
        if (original && (position.x !== original.x || position.y !== original.y)) {
          this.dependencies.dispatch({ type: 'move-point', index: preview.index, point: position })
        }
        // Clear the context panel after a drag so it cannot cover the next touch.
        this.dependencies.onPointSelected?.(null)
      }
    }
    this.releasePointer(pointer.id, true)
  }

  pointerCancel(id: number): void {
    this.releasePointer(id, false)
  }

  cancelActiveGesture(): void {
    this.abortGesture()
    this.pointers.clear()
    this.navigating = false
    this.navAnchor = undefined
    this.terrainStroke = undefined
  }

  navigationActive(): boolean {
    return this.navigating
  }

  private releasePointer(id: number, commit: boolean): void {
    if (!this.pointers.delete(id)) return
    if (this.navigating) {
      this.navAnchor = this.pinchSample()
      if (this.pointers.size === 0) this.navigating = false
      return
    }
    if (commit) this.finishPointer(id, true)
    else this.abortGesture()
  }

  private abortGesture(): void {
    if (this.activePointer === undefined) return
    this.terrainStroke = undefined
    this.sceneryGesture = undefined
    this.checkpointGesture = undefined
    this.pendingDrawStart = undefined
    if (this.gestureTool === 'select') {
      if (this.selectedPoint >= 0) this.dependencies.onPointSelected?.(null)
      else this.dependencies.onCrossingSelected?.(null)
    }
    if (this.gestureHasTransaction) {
      this.dependencies.dispatch({ type: 'cancel-gesture' })
    }
    this.gestureHasTransaction = false
    this.activePointer = undefined
    this.gestureTool = undefined
    this.lastScreen = undefined
    this.selectedPoint = -1
    this.selectionStart = undefined
    this.selectionPoints = undefined
    this.roadPreview = undefined
    this.drawStartIndex = 0
  }

  private pinchSample(): { center: Vector2; distance: number } | undefined {
    const [a, b] = [...this.pointers.values()]
    if (!a || !b) return undefined
    return {
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    }
  }

  private finishPointer(id: number, commitTerrain: boolean): void {
    if (id !== this.activePointer) return
    const tool = this.dependencies.tool()
    const sceneryGesture = this.sceneryGesture
    if (sceneryGesture) {
      if (tool !== 'tree' || !this.sceneryGestureValid()) {
        this.abortGesture()
        return
      }
      this.commitSceneryGesture(sceneryGesture)
    }
    if (tool === 'draw') {
      this.commitPendingDrawStart()
      this.dependencies.dispatch({
        type: 'finalize-draw',
        startIndex: this.drawStartIndex,
        zoom: this.dependencies.camera.zoom,
      })
      this.dependencies.dispatch({ type: 'normalize-loop' })
    }
    if (commitTerrain) {
      this.commitTerrainStroke()
    } else {
      this.terrainStroke = undefined
    }
    if (this.gestureHasTransaction) {
      this.dependencies.dispatch({ type: 'end-gesture' })
    }
    this.gestureHasTransaction = false
    this.activePointer = undefined
    this.gestureTool = undefined
    this.lastScreen = undefined
    this.selectedPoint = -1
    this.selectionStart = undefined
    this.selectionPoints = undefined
    this.roadPreview = undefined
    this.drawStartIndex = 0
    this.pendingDrawStart = undefined
    this.checkpointGesture = undefined
  }

  zoomBy(delta: number): void {
    this.dependencies.camera.zoom = clamp(
      this.dependencies.camera.zoom + delta,
      minimumEditorZoomOut(this.dependencies.camera.zoom, this.dependencies.viewport?.() ?? { width: 0, height: 0 }),
      EDITOR_ZOOM_LIMITS.maximum,
    )
    this.dependencies.onCameraChanged?.()
  }

  roadPointPreview(): typeof this.roadPreview {
    return this.dependencies.editor().points === this.selectionPoints ? this.roadPreview : undefined
  }

  selectedControlPoint(): number {
    return this.selectedPoint
  }

  sceneryPreview(): { type: 'tree' | 'prop'; index: number; position: Vector2 } | null {
    const gesture = this.sceneryGesture
    if (!gesture || gesture.type === 'empty' || !gesture.dragging || !this.sceneryGestureValid()) return null
    return { type: gesture.type, index: gesture.index, position: gesture.position }
  }

  private worldPosition(pointer: PointerSample): Vector2 {
    return this.dependencies.worldPoint?.(pointer) ?? {
      x: pointer.x / this.dependencies.camera.zoom + this.dependencies.camera.x,
      y: pointer.y / this.dependencies.camera.zoom + this.dependencies.camera.y,
    }
  }

  private sceneryGestureValid(): boolean {
    const gesture = this.sceneryGesture
    if (!gesture || this.dependencies.tool() !== 'tree') return false
    const editor = this.dependencies.editor()
    return editor.environmentId === gesture.environmentId &&
      this.dependencies.sceneryChoice?.() === gesture.choice &&
      (gesture.type === 'empty' || (gesture.type === 'tree' ? editor.trees[gesture.index] : editor.scenery[gesture.index]) === gesture.source)
  }

  private beginSceneryGesture(pointer: PointerSample, world: Vector2): void {
    const editor = this.dependencies.editor()
    const choice = this.dependencies.sceneryChoice?.() ?? 'tree'
    const candidates: SceneryHit[] = []
    const margin = 12 / this.dependencies.camera.zoom
    const art = getTrackEnvironment(editor.environmentId).scenery
    editor.trees.forEach((source, index) => {
      const distance = Math.hypot(world.x - source.x, world.y - source.y)
      if (distance <= 15 + margin) candidates.push({ type: 'tree', index, source, distance })
    })
    editor.scenery.forEach((source, index) => {
      if (!sceneryKindBelongsToEnvironment(source.kind, editor.environmentId)) return
      const radius = art[source.kind]?.radius ?? 0
      const distance = Math.hypot(world.x - source.x, world.y - source.y)
      if (distance <= radius + margin) candidates.push({ type: 'prop', index, source, distance })
    })
    // Trees are drawn after themed props, and later items win an exact tie.
    candidates.sort((a, b) => a.distance - b.distance || (a.type === b.type ? b.index - a.index : a.type === 'tree' ? -1 : 1))
    const hit = candidates[0]
    this.sceneryGesture = {
      type: hit?.type ?? 'empty',
      index: hit?.index ?? -1,
      source: hit?.source,
      environmentId: editor.environmentId,
      choice,
      start: { x: pointer.x, y: pointer.y },
      offset: hit
        ? { x: world.x - hit.source.x, y: world.y - hit.source.y }
        : { x: 0, y: 0 },
      position: hit?.source ?? world,
      dragging: false,
    }
  }

  private updateSceneryGesture(pointer: PointerSample): void {
    const gesture = this.sceneryGesture
    if (!gesture || !this.sceneryGestureValid()) return
    if (Math.hypot(pointer.x - gesture.start.x, pointer.y - gesture.start.y) >= 6) gesture.dragging = true
    const world = this.worldPosition(pointer)
    gesture.position = { x: world.x - gesture.offset.x, y: world.y - gesture.offset.y }
  }

  private commitSceneryGesture(gesture: SceneryGesture): void {
    this.sceneryGesture = undefined
    if (gesture.choice === 'erase-scenery') {
      if (!gesture.dragging && gesture.type !== 'empty') this.dependencies.dispatch({ type: gesture.type === 'tree' ? 'erase-tree' : 'erase-scenery-prop', index: gesture.index })
      return
    }
    if (gesture.type !== 'empty' && !gesture.dragging) return
    if (gesture.type === 'empty' && gesture.dragging) return
    const rejection = treePlacementRejection(this.dependencies.editor().terrain, gesture.position)
    if (rejection || !isSceneryPosition(gesture.position)) {
      this.dependencies.onRejected?.(rejection ?? INVALID_SCENERY_POSITION_REJECTION)
      return
    }
    if (gesture.type === 'tree') this.dependencies.dispatch({ type: 'move-tree', index: gesture.index, position: gesture.position })
    else if (gesture.type === 'prop') this.dependencies.dispatch({ type: 'move-scenery-prop', index: gesture.index, position: gesture.position })
    else if (gesture.choice === 'tree') this.dependencies.dispatch({ type: 'add-tree', tree: gesture.position })
    else this.dependencies.dispatch({ type: 'add-scenery-prop', prop: { kind: gesture.choice, ...gesture.position } })
  }

  terrainCellPreview(): TerrainCellPreview | null {
    const stroke = this.terrainStroke
    return stroke?.preview ? { ...stroke.preview, cells: [...stroke.cellsByKey.values()] } : null
  }

  terrainPreview(): TerrainPreview | null {
    const stroke = this.terrainStroke
    const preview = stroke?.preview
    if (!stroke || !preview) return null
    if (stroke.materialized?.revision !== preview.revision) {
      const cells = [...stroke.cellsByKey.values()].sort(
        (left, right) =>
          left.row - right.row || left.column - right.column,
      )
      stroke.materialized = {
        revision: preview.revision,
        cells,
        terrain: terrainWithStroke(stroke.baseTerrain, cells, stroke.kind),
      }
    }
    return {
      ...preview,
      cells: stroke.materialized.cells,
      terrain: stroke.materialized.terrain,
    }
  }

  private commitTerrainStroke(): void {
    const stroke = this.terrainStroke
    if (!stroke) return
    this.terrainStroke = undefined
    if (stroke.rejected || stroke.cellsByKey.size === 0) return
    const cells = [...stroke.cellsByKey.values()].sort(
      (left, right) => left.row - right.row || left.column - right.column,
    )
    this.dependencies.dispatch({
      type: 'paint-terrain',
      cells,
      kind: stroke.kind,
    })
  }

  private paintTerrainAt(world: Vector2): void {
    if (!this.terrainStroke) {
      const brush = this.dependencies.terrainBrush?.() ?? {
        kind: 'hill' as const,
        radius: DEFAULT_TERRAIN_BRUSH_RADIUS,
      }
      this.terrainStroke = {
        kind: brush.kind,
        radius: brush.radius,
        baseTerrain: this.dependencies.editor().terrain,
        baseKindsByKey: new Map(
          this.dependencies.editor().terrain.cells.map((cell) => [
            terrainCellKey(cell),
            cell.kind,
          ]),
        ),
        cellsByKey: new Map(),
        candidateCellCount: this.dependencies.editor().terrain.cells.length,
        lastWorld: undefined,
        revision: this.terrainPreviewRevision,
        rejected: false,
        materialized: undefined,
        preview: undefined,
      }
    }
    const stroke = this.terrainStroke
    if (stroke.rejected) return
    const start = stroke.lastWorld ?? world
    const distance = Math.hypot(world.x - start.x, world.y - start.y)
    const divisions = Math.max(1, Math.ceil(distance / 16))
    let changed = false
    const dirtyCells: TerrainCellCoordinate[] = []
    for (let step = stroke.lastWorld ? 1 : 0; step <= divisions; step += 1) {
      const ratio = step / divisions
      const position = {
        x: start.x + (world.x - start.x) * ratio,
        y: start.y + (world.y - start.y) * ratio,
      }
      const brush = planTerrainCellsInBrush(position, stroke.radius)
      if (!brush.ok) {
        this.rejectTerrainStroke(TERRAIN_COORDINATE_BOUNDS_REJECTION)
        return
      }
      for (const cell of brush.cells) {
        const key = terrainCellKey(cell)
        if (stroke.cellsByKey.has(key)) continue
        const baseKind = stroke.baseKindsByKey.get(key)
        const effective =
          stroke.kind === 'ground'
            ? baseKind !== undefined
            : baseKind !== stroke.kind
        if (!effective) continue
        if (
          stroke.kind !== 'ground' &&
          baseKind === undefined &&
          stroke.candidateCellCount >= TERRAIN_LIMITS.maximumCells
        ) {
          this.rejectTerrainStroke(TERRAIN_CAPACITY_REJECTION)
          return
        }
        stroke.cellsByKey.set(key, cell)
        if (stroke.kind === 'ground') stroke.candidateCellCount -= 1
        else if (baseKind === undefined) stroke.candidateCellCount += 1
        dirtyCells.push(cell)
        changed = true
      }
    }
    stroke.lastWorld = { ...world }
    if (changed) {
      this.terrainPreviewRevision += 1
      stroke.revision = this.terrainPreviewRevision
      stroke.materialized = undefined
    }
    stroke.preview = {
      revision: stroke.revision,
      position: { ...world },
      radius: stroke.radius,
      dirtyCells: changed
        ? dirtyCells.sort(
            (left, right) =>
              left.row - right.row || left.column - right.column,
          )
        : (stroke.preview?.dirtyCells ?? []),
      kind: stroke.kind,
    }
  }

  private rejectTerrainStroke(rejection: EditorCommandRejection): void {
    const stroke = this.terrainStroke
    if (!stroke) return
    stroke.cellsByKey.clear()
    stroke.preview = undefined
    stroke.materialized = undefined
    stroke.rejected = true
    this.dependencies.onRejected?.(rejection)
  }

  private commitPendingDrawStart(): void {
    const start = this.pendingDrawStart
    if (!start) return
    this.pendingDrawStart = undefined
    this.drawRoadAt(start.world)
  }

  private drawRoadAt(world: Vector2): void {
    const editor = this.dependencies.editor()
    const points = appendDrawPoint(
      editor.points,
      world,
      this.dependencies.surface(),
      this.dependencies.camera.zoom,
    )
    if (points === editor.points) return
    const point = points.at(-1)
    if (!point) return
    if (points.length === editor.points.length) {
      this.dependencies.dispatch({ type: 'move-point', index: points.length - 1, point })
    } else {
      this.dependencies.dispatch({ type: 'add-point', point })
    }
  }


  private beginCheckpointGesture(pointer: PointerSample, world: Vector2): void {
    const path = this.dependencies.path?.()
    if (!path || path.totalLength <= 0) return
    const mark = nearestCheckpointMarker(
      path.points, path.closed, this.dependencies.editor().recoveryCheckpoints,
      world, this.dependencies.camera.zoom,
    )
    this.checkpointGesture = { start: pointer, mark, dragging: false }
  }

  private updateCheckpointGesture(pointer: PointerSample): void {
    const gesture = this.checkpointGesture
    if (!gesture || gesture.mark === undefined) return
    if (!gesture.dragging &&
        Math.hypot(pointer.x - gesture.start.x, pointer.y - gesture.start.y) < SELECTION_DRAG_SCREEN_PIXELS) return
    gesture.dragging = true
    const path = this.dependencies.path?.()
    if (!path || !path.totalLength) return
    const samples = path.closed ? path.points.length : path.points.length - 1
    const previousIndex = Math.round(gesture.mark * samples)
    const world = this.worldPosition(pointer)
    const nearby = nearestPathPoint(path, world, previousIndex, 80)
    const nearest = nearby && nearby.distance <= ROAD_GEOMETRY.onRoadRadius + 10 / this.dependencies.camera.zoom
      ? nearby : nearestPathPoint(path, world)
    if (!nearest || nearest.distance > ROAD_GEOMETRY.onRoadRadius + 10 / this.dependencies.camera.zoom ||
        !isSafeRoadRecoverySample(path, nearest.index)) return
    const to = nearest.point.distance / path.totalLength
    if (to === gesture.mark || to >= 1 || this.dependencies.editor().recoveryCheckpoints
      .some(mark => mark !== gesture.mark && Math.abs(mark - to) * path.totalLength < 18)) return
    this.dependencies.dispatch({ type: 'move-recovery-checkpoint', from: gesture.mark, to })
    gesture.mark = to
  }

  private finishCheckpointGesture(pointer: PointerSample): void {
    const gesture = this.checkpointGesture
    if (!gesture) return
    this.updateCheckpointGesture(pointer)
    if (gesture.dragging) return
    if (gesture.mark !== undefined) {
      this.dependencies.dispatch({ type: 'toggle-recovery-checkpoint', ratio: gesture.mark })
      return
    }
    if (Math.hypot(pointer.x - gesture.start.x, pointer.y - gesture.start.y) >= SELECTION_DRAG_SCREEN_PIXELS) return
    const path = this.dependencies.path?.()
    if (!path || !path.totalLength) return
    const nearest = nearestPathPoint(path, this.worldPosition(pointer))
    if (!nearest || nearest.distance > ROAD_GEOMETRY.onRoadRadius + 10 / this.dependencies.camera.zoom ||
        !isSafeRoadRecoverySample(path, nearest.index)) return
    const ratio = nearest.point.distance / path.totalLength
    if (ratio < 1 && !this.dependencies.editor().recoveryCheckpoints
      .some(mark => Math.abs(mark - ratio) * path.totalLength < 18)) {
      this.dependencies.dispatch({ type: 'toggle-recovery-checkpoint', ratio })
    }
  }

  private applyTool(
    pointer: PointerSample,
    phase: 'down' | 'move',
  ): void {
    const world = this.worldPosition(pointer)
    switch (this.dependencies.tool()) {
      case 'draw':
        this.drawRoadAt(world)
        break
      case 'insert': {
        if (phase !== 'down') break
        const editor = this.dependencies.editor()
        const segment = nearestSegmentIndex(editor.points, world, this.dependencies.camera.zoom)
        if (segment < 0) break
        const insertion = planPointInsertion(editor.points, segment, world)
        if (insertion) this.dependencies.dispatch({ type: 'insert-point', ...insertion })
        break
      }
      case 'tree':
        if (this.dependencies.sceneryChoice) {
          if (phase === 'down') this.beginSceneryGesture(pointer, world)
          else this.updateSceneryGesture(pointer)
          break
        }
        if (phase === 'down') {
          const rejection = treePlacementRejection(
            this.dependencies.editor().terrain,
            world,
          )
          if (rejection) {
            this.dependencies.onRejected?.(rejection)
          } else if (!this.dependencies.sceneryChoice) {
            this.dependencies.dispatch({ type: 'add-tree', tree: world })
          }
        }
        break
      case 'start':
        if (this.dependencies.editor().routeKind !== 'circuit') break
        if (phase === 'down') {
          const path = this.dependencies.path?.()
          if (!path) break
          const nearest = nearestPathPoint(path, world)
          if (nearest && path.totalLength > 0) {
            this.dependencies.dispatch({
              type: 'set-track-start',
              ratio: nearest.point.distance / path.totalLength,
            })
          }
        }
        break
      case 'checkpoint':
        if (phase === 'down') this.beginCheckpointGesture(pointer, world)
        else this.updateCheckpointGesture(pointer)
        break
      case 'select':
        if (phase === 'down') {
          const editor = this.dependencies.editor()
          const point = nearestControlPoint(
            editor.points,
            world,
            this.dependencies.camera.zoom,
          )
          // Phaser supplies the live hit shape; the pure geometry fallback
          // keeps headless editor command tests independent of a canvas.
          const contains = this.dependencies.polygonContains ?? pointInPolygon
          const crossings = this.dependencies.path?.().crossings ?? []
          let crossing: { candidate: (typeof crossings)[number]; distance: number } | undefined
          for (const candidate of crossings) {
            if (!contains(world, candidate.polygon)) continue
            const distance = Math.hypot(candidate.position.x - world.x, candidate.position.y - world.y)
            if (!crossing || distance < crossing.distance) crossing = { candidate, distance }
          }
          const control = point >= 0 ? editor.points[point] : undefined
          const controlDistance = control
            ? Math.hypot(control.x - world.x, control.y - world.y)
            : Number.POSITIVE_INFINITY
          if (crossing && crossing.distance < controlDistance) {
            this.selectedPoint = -1
            this.dependencies.onCrossingSelected?.(crossing.candidate.key)
            this.dependencies.onPointSelected?.(null)
          } else {
            this.selectedPoint = point
            this.selectionPoints = editor.points
            this.dependencies.onCrossingSelected?.(null)
            this.dependencies.onPointSelected?.(point >= 0 ? point : null)
          }
        } else if (this.selectedPoint >= 0) {
          this.roadPreview = { index: this.selectedPoint, position: world }
        }
        break
      case 'paint': {
        const editor = this.dependencies.editor()
        const index = nearestSegmentIndex(
          editor.points,
          world,
          this.dependencies.camera.zoom,
        )
        if (index >= 0) {
          this.dependencies.dispatch({
            type: 'paint-point',
            index,
            surface: surfaceForIndex(
              this.dependencies.surface(),
              index,
            ),
          })
        }
        break
      }
      case 'structure': {
        const editor = this.dependencies.editor()
        const index = nearestSegmentIndex(
          editor.points,
          world,
          this.dependencies.camera.zoom,
        )
        if (index >= 0) {
          this.dependencies.dispatch({
            type: 'paint-section-structure',
            index,
            structure: this.dependencies.structure?.() ?? 'overpass',
          })
        }
        break
      }
      case 'terrain':
        this.paintTerrainAt(world)
        break
      case 'erase':
        if (phase === 'down') {
          const editor = this.dependencies.editor()
          const point = nearestControlPoint(
            editor.points,
            world,
            this.dependencies.camera.zoom,
          )
          if (point >= 0) {
            this.dependencies.dispatch({
              type: 'erase-point',
              index: point,
            })
          } else {
            const tree = nearestTree(
              editor.trees,
              world,
              this.dependencies.camera.zoom,
            )
            if (tree >= 0) {
              this.dependencies.dispatch({
                type: 'erase-tree',
                index: tree,
              })
            }
          }
        }
        break
      case 'pan':
        break
    }
  }
}
