import type { AppSnapshot } from '@/application/appState'
import type { TerrainBrushRadius } from '@/domain/config'
import type {
  EditorCameraAction,
  EditorSurface,
  EditorTool,
} from '@/domain/editor/editorGeometry'
import type { RoadStructure } from '@/domain/model'
import type { TerrainBrushMode } from '@/domain/editor/terrainBrush'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { createEditorContextDock } from '@/ui/editor/editorContextDock'
import {
  createEditorDiagnostics,
  createEditorHistoryActions,
  createEditorStatus,
  createEditorTopbar,
  createEditorTrackActions,
  type EditorFrameActions,
} from '@/ui/editor/editorFrameControls'
import { createEditorSelectionPanels } from '@/ui/editor/editorSelectionPanels'
import { createEditorToolPalette } from '@/ui/editor/editorToolPalette'
import { element } from '@/ui/dom'

export interface EditorChromeActions extends EditorFrameActions {
  readonly tool: (tool: EditorTool) => void
  readonly surface: (surface: EditorSurface) => void
  readonly structure: (structure: RoadStructure) => void
  readonly terrainMode: (mode: TerrainBrushMode) => void
  readonly terrainRadius: (radius: TerrainBrushRadius) => void
  readonly camera: (action: EditorCameraAction) => void
}

/** Composes one editor DOM path whose CSS adapts it for desktop and mobile. */
export function createEditorChrome(
  state: AppSnapshot,
  actions: EditorChromeActions,
  geometry: TrackGeometry,
): HTMLElement {
  const screen = element('section', 'screen editor-screen')
  screen.dataset.screen = 'editor'
  screen.append(
    createEditorTopbar(state, actions),
    createEditorToolPalette(state, actions),
    createEditorHistoryActions(state, actions),
    createEditorStatus(state, geometry),
    createEditorContextDock(state, actions),
    createEditorTrackActions(actions),
    ...createEditorSelectionPanels(state, actions, geometry),
  )
  const diagnostics = createEditorDiagnostics(state, actions, geometry)
  if (diagnostics) screen.append(diagnostics)
  return screen
}
