import type { TerrainBrushRadius } from '@/domain/config'
import type { EditorTool } from '@/domain/editor/editorGeometry'
import type { TerrainBrushMode } from '@/domain/editor/terrainBrush'

export interface EditorRenderState {
  readonly points: object
  readonly terrain: object
  readonly trees: object
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
  readonly grid: boolean
  readonly overlay: boolean
  readonly preview: boolean
}

export function editorSnapshotRenderChanges(
  previous: EditorRenderState | undefined,
  current: EditorRenderState,
  cameraChanged: boolean,
): EditorRenderChanges {
  if (!previous) {
    return { world: true, grid: true, overlay: true, preview: true }
  }
  const geometryChanged =
    previous.points !== current.points ||
    previous.terrain !== current.terrain ||
    previous.start !== current.start
  return {
    world:
      geometryChanged ||
      previous.trees !== current.trees ||
      previous.night !== current.night,
    grid:
      cameraChanged ||
      previous.grid !== current.grid ||
      previous.night !== current.night,
    overlay:
      geometryChanged ||
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
