import {
  normalizeEditorSceneryChoice,
  type AppCommand,
  type EditorUiState,
} from '@/application/appState'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'

type EditorUiAction =
  | 'set-editor-scenery'
  | 'select-editor-scenery'
  | 'set-editor-tool'
  | 'select-editor-crossing'
  | 'select-editor-point'
  | 'set-editor-surface'
  | 'set-editor-structure'
  | 'set-editor-terrain-mode'
  | 'set-editor-terrain-radius'
  | 'toggle-editor-grid'
  | 'request-editor-camera'

export type EditorUiCommand = Extract<AppCommand, { readonly type: EditorUiAction }>

/** Pure editor chrome transitions. The controller owns publishing and saving. */
export function reduceEditorUi(
  state: EditorUiState,
  command: EditorUiCommand,
  environmentId: TrackEnvironmentId,
): EditorUiState {
  switch (command.type) {
    case 'select-editor-scenery':
      return state.tool === 'tree' ? { ...state, selectedScenery: command.target } : state
    case 'set-editor-scenery':
      return { ...state, sceneryChoice: normalizeEditorSceneryChoice(command.choice, environmentId), ...(state.selectedScenery ? { selectedScenery: null } : {}) }
    case 'set-editor-tool':
      return {
        ...state, tool: command.tool,
        ...(command.tool !== 'tree' && state.selectedScenery ? { selectedScenery: null } : {}),
        selectedCrossing: command.tool === 'select' ? state.selectedCrossing : null,
        selectedPoint: command.tool === 'select' ? state.selectedPoint : null,
      }
    case 'select-editor-crossing':
      return {
        ...state,
        selectedCrossing: command.key,
        selectedPoint: command.key === null ? state.selectedPoint : null,
      }
    case 'select-editor-point':
      return {
        ...state,
        selectedPoint: command.index,
        selectedCrossing: command.index === null ? state.selectedCrossing : null,
      }
    case 'set-editor-surface':
      return { ...state, surface: command.surface }
    case 'set-editor-structure':
      return { ...state, structure: command.structure }
    case 'set-editor-terrain-mode':
      return { ...state, terrainBrush: { ...state.terrainBrush, mode: command.mode } }
    case 'set-editor-terrain-radius':
      return { ...state, terrainBrush: { ...state.terrainBrush, radius: command.radius } }
    case 'toggle-editor-grid':
      return { ...state, grid: !state.grid }
    case 'request-editor-camera':
      return {
        ...state,
        cameraRequest: {
          sequence: (state.cameraRequest?.sequence ?? 0) + 1,
          action: command.action,
        },
      }
  }
}
