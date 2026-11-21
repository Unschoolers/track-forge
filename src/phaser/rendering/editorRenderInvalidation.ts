import type { TerrainBrushRadius } from '@/domain/config'
import type { EditorTool } from '@/domain/editor/editorGeometry'
import type { TerrainBrushMode } from '@/domain/editor/terrainBrush'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { RouteKind, Vector2 } from '@/domain/model'

export interface EditorRenderState {
  readonly routeKind: RouteKind
  readonly points: object
  readonly terrain: object
  readonly trees: object
  readonly scenery: object
  readonly recoveryCheckpoints?: object
  readonly environmentId: TrackEnvironmentId
  readonly start: object | undefined
  readonly night: boolean
  readonly grid: boolean
  readonly selectedPoint: number | null
  readonly selectedCrossing: string | null
  readonly tool: EditorTool
  readonly terrainMode: TerrainBrushMode
  readonly terrainRadius: TerrainBrushRadius
}

export interface EditorRenderChanges {
  readonly world: boolean
  readonly appearance: boolean
  readonly grid: boolean
  readonly overlay: boolean
  readonly preview: boolean
}

export function editorTreeRenderRequired(
  previous: EditorRenderState | undefined,
  current: EditorRenderState,
): boolean {
  return !previous || previous.trees !== current.trees ||
    previous.terrain !== current.terrain || previous.night !== current.night
}

type SceneryPreview = {
  readonly type: 'tree' | 'prop'
  readonly index: number
  readonly position: Vector2
} | null

export function treePreviewRenderRequired(
  previous: SceneryPreview,
  current: SceneryPreview,
): boolean {
  const before = previous?.type === 'tree' ? previous : null
  const after = current?.type === 'tree' ? current : null
  if (!before || !after) return before !== after
  return before.index !== after.index || before.position.x !== after.position.x ||
    before.position.y !== after.position.y
}

export function editorSnapshotRenderChanges(
  previous: EditorRenderState | undefined,
  current: EditorRenderState,
  cameraChanged: boolean,
): EditorRenderChanges {
  if (!previous) {
    return { world: true, appearance: true, grid: true, overlay: true, preview: true }
  }
  const geometryChanged =
    previous.routeKind !== current.routeKind ||
    previous.points !== current.points ||
    previous.terrain !== current.terrain ||
    previous.start !== current.start
  return {
    world:
      geometryChanged ||
      previous.night !== current.night,
    appearance: previous.environmentId !== current.environmentId || previous.scenery !== current.scenery || previous.trees !== current.trees || previous.night !== current.night || (previous.tool !== current.tool && (previous.tool === 'tree' || current.tool === 'tree')),
    grid:
      cameraChanged ||
      previous.grid !== current.grid ||
      previous.night !== current.night,
    overlay:
      cameraChanged ||
      geometryChanged ||
      previous.recoveryCheckpoints !== current.recoveryCheckpoints ||
      previous.selectedPoint !== current.selectedPoint ||
      previous.selectedCrossing !== current.selectedCrossing,
    preview:
      previous.night !== current.night ||
      previous.tool !== current.tool ||
      previous.terrainMode !== current.terrainMode ||
      previous.terrainRadius !== current.terrainRadius,
  }
}

export function editorPointerRenderChanges(
  tool: EditorTool,
): EditorRenderChanges {
  return {
    world: false,
    appearance: tool === 'tree',
    grid: false,
    overlay: false,
    preview: tool === 'terrain',
  }
}

export function terrainPreviewCompileRequired(
  compiledRevision: number | undefined,
  preview: {
    readonly revision: number
    readonly dirtyCells: readonly unknown[]
  } | null,
): boolean {
  return (
    preview !== null &&
    preview.dirtyCells.length > 0 &&
    preview.revision !== compiledRevision
  )
}
