import type { EditorCommand } from '@/domain/editor/editorState'
import type { EditorState } from '@/domain/editor/editorState'
import {
  DEFAULT_TERRAIN_BRUSH_RADIUS,
  TERRAIN_LIMITS,
  type TerrainBrushRadius,
} from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type {
  RoadStructure,
  TerrainBrushKind,
  Vector2,
} from '@/domain/model'
import {
  appendDrawPoint,
  nearestControlPoint,
  nearestSegmentIndex,
  nearestTree,
  surfaceForIndex,
  type EditorSurface,
  type EditorTool,
} from '@/domain/editor/editorGeometry'
import {
  nearestPathPoint,
  type RoadPath,
} from '@/domain/track/pathBuilder'
import {
  planTerrainCellsInBrush,
  planTerrainPaint,
  terrainCellKey,
  type TerrainCellCoordinate,
} from '@/domain/terrain/terrainField'
import type { TerrainMap } from '@/domain/model'
import {
  TERRAIN_CAPACITY_REJECTION,
  TERRAIN_COORDINATE_BOUNDS_REJECTION,
  treePlacementRejection,
  type EditorCommandRejection,
} from '@/domain/editor/editorConstraints'

export type { EditorTool } from '@/domain/editor/editorGeometry'

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

type TerrainPreviewDraft = Omit<TerrainPreview, 'cells' | 'terrain'>

export interface EditorInputDependencies {
  readonly camera: EditorCamera
  readonly tool: () => EditorTool
  readonly surface: () => EditorSurface
  readonly structure?: () => RoadStructure
  readonly terrainBrush?: () => TerrainBrush
  readonly editor: () => EditorState
  readonly path?: () => RoadPath
  readonly dispatch: (command: EditorCommand) => void
  readonly worldPoint?: (pointer: PointerSample) => Vector2
  readonly onCameraChanged?: () => void
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
  private lastScreen: Vector2 | undefined
  private selectedPoint = -1
  private drawStartIndex = 0
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
    if (this.activePointer !== undefined) {
      if (this.terrainStroke) this.finishPointer(this.activePointer, false)
      return
    }
    this.activePointer = pointer.id
    this.lastScreen = pointer
    this.drawStartIndex = this.dependencies.editor().points.length
    if (this.dependencies.tool() !== 'pan') {
      this.dependencies.dispatch({ type: 'begin-gesture' })
    }
    this.applyTool(pointer, 'down')
  }

  pointerMove(pointer: PointerSample): void {
    if (pointer.id !== this.activePointer) return
    const previous = this.lastScreen
    if (this.dependencies.tool() === 'pan' && previous) {
      this.dependencies.camera.x -=
        (pointer.x - previous.x) / this.dependencies.camera.zoom
      this.dependencies.camera.y -=
        (pointer.y - previous.y) / this.dependencies.camera.zoom
      this.dependencies.onCameraChanged?.()
    } else {
      this.applyTool(pointer, 'move')
    }
    this.lastScreen = pointer
  }

  pointerUp(pointer: PointerSample): void {
    this.finishPointer(pointer.id, true)
  }

  pointerCancel(id: number): void {
    this.finishPointer(id, false)
  }

  cancelActiveGesture(): void {
    if (this.activePointer === undefined) {
      this.terrainStroke = undefined
      return
    }
    this.finishPointer(this.activePointer, false)
  }

  private finishPointer(id: number, commitTerrain: boolean): void {
    if (id !== this.activePointer) return
    const tool = this.dependencies.tool()
    if (tool === 'draw') {
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
    if (tool !== 'pan') {
      this.dependencies.dispatch({ type: 'end-gesture' })
    }
    this.activePointer = undefined
    this.lastScreen = undefined
    this.selectedPoint = -1
    this.drawStartIndex = 0
  }

  zoomBy(delta: number): void {
    this.dependencies.camera.zoom = clamp(
      this.dependencies.camera.zoom + delta,
      0.16,
      2.7,
    )
    this.dependencies.onCameraChanged?.()
  }

  selectedControlPoint(): number {
    return this.selectedPoint
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
      const plan = planTerrainPaint(stroke.baseTerrain, cells, stroke.kind)
      if (!plan.ok) {
        this.rejectTerrainStroke(
          plan.reason === 'coordinate-bounds'
            ? TERRAIN_COORDINATE_BOUNDS_REJECTION
            : TERRAIN_CAPACITY_REJECTION,
        )
        return null
      }
      stroke.materialized = {
        revision: preview.revision,
        cells: plan.changedCells,
        terrain: plan.terrain,
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

  private applyTool(
    pointer: PointerSample,
    phase: 'down' | 'move',
  ): void {
    const world =
      this.dependencies.worldPoint?.(pointer) ?? {
        x:
          pointer.x / this.dependencies.camera.zoom +
          this.dependencies.camera.x,
        y:
          pointer.y / this.dependencies.camera.zoom +
          this.dependencies.camera.y,
      }
    switch (this.dependencies.tool()) {
      case 'draw': {
        const editor = this.dependencies.editor()
        const points = appendDrawPoint(
          editor.points,
          world,
          this.dependencies.surface(),
          this.dependencies.camera.zoom,
        )
        if (points === editor.points) break
        const point = points.at(-1)
        if (!point) break
        if (points.length === editor.points.length) {
          this.dependencies.dispatch({
            type: 'move-point',
            index: points.length - 1,
            point,
          })
        } else {
          this.dependencies.dispatch({ type: 'add-point', point })
        }
        break
      }
      case 'tree':
        if (phase === 'down') {
          const rejection = treePlacementRejection(
            this.dependencies.editor().terrain,
            world,
          )
          if (rejection) {
            this.dependencies.onRejected?.(rejection)
          } else {
            this.dependencies.dispatch({ type: 'add-tree', tree: world })
          }
        }
        break
      case 'start':
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
      case 'select':
        if (phase === 'down') {
          const editor = this.dependencies.editor()
          const point = nearestControlPoint(
            editor.points,
            world,
            this.dependencies.camera.zoom,
          )
          const crossing = (this.dependencies.path?.().crossings ?? [])
            .map((candidate) => ({
              candidate,
              distance: Math.hypot(
                candidate.position.x - world.x,
                candidate.position.y - world.y,
              ),
            }))
            .filter(
              ({ candidate }) => pointInPolygon(world, candidate.polygon),
            )
            .sort((left, right) => left.distance - right.distance)[0]
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
            this.dependencies.onCrossingSelected?.(null)
            this.dependencies.onPointSelected?.(point >= 0 ? point : null)
          }
        } else if (this.selectedPoint >= 0) {
          this.dependencies.dispatch({
            type: 'move-point',
            index: this.selectedPoint,
            point: world,
          })
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
