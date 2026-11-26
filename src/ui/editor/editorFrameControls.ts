import type { AppSnapshot } from '@/application/appState'
import type { EditorCommand } from '@/domain/editor/editorState'
import type { EditorCameraAction } from '@/domain/editor/editorGeometry'
import { analyzeTrack } from '@/domain/track/trackDiagnostics'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { validateTrack } from '@/domain/track/trackValidation'
import { button, element } from '@/ui/dom'
import { editorIcon, editorIconButton } from '@/ui/editor/editorIcons'

export interface EditorFrameActions {
  readonly home: () => void
  readonly race: () => void
  readonly menu: () => void
  readonly save: () => void
  readonly load: () => void
  readonly camera: (action: EditorCameraAction) => void
  readonly toggleGrid: () => void
  readonly edit: (command: EditorCommand) => void
}

export function createEditorTopbar(
  state: Pick<AppSnapshot, 'currentTrack'>,
  actions: Pick<EditorFrameActions, 'home' | 'menu'>,
): HTMLElement {
  const topbar = element('header', 'topbar')
  topbar.append(
    editorIconButton('home', 'home', 'Home', actions.home),
    element('span', 'topbar-title', state.currentTrack?.name ?? 'NO TRACK'),
    editorIconButton('menu', 'editor-menu', 'Editor menu', actions.menu),
  )
  return topbar
}

export function createEditorHistoryActions(
  state: Pick<AppSnapshot, 'editorUi'>,
  actions: Pick<EditorFrameActions, 'camera' | 'edit' | 'toggleGrid'>,
): HTMLElement {
  const history = element('div', 'history-actions')
  history.setAttribute('aria-label', 'History and view tools')
  const undo = editorIconButton('undo', 'undo', 'Undo', () => actions.edit({ type: 'undo' }))
  const redo = editorIconButton('redo', 'redo', 'Redo', () => actions.edit({ type: 'redo' }))
  undo.append(element('span', 'editor-action-label', 'Undo'))
  redo.append(element('span', 'editor-action-label', 'Redo'))

  const drawer = element('details', 'editor-view-drawer')
  const summary = element('summary', 'editor-view-summary')
  summary.append(editorIcon('fit'), element('span', '', 'VIEW'))
  const choices = element('div', 'editor-view-items')
  const viewActions = [
    editorIconButton('zoom-in', 'zoom-in', 'Zoom in', () => actions.camera('zoom-in')),
    editorIconButton('zoom-out', 'zoom-out', 'Zoom out', () => actions.camera('zoom-out')),
    editorIconButton('fit', 'fit-track', 'Fit track', () => actions.camera('fit')),
    editorIconButton('expand', 'expand-track', 'Expand track 2×', () => actions.edit({ type: 'expand', factor: 2 })),
    editorIconButton('grid', 'toggle-grid', 'Toggle grid', actions.toggleGrid,
      `icon-button${state.editorUi.grid ? ' active' : ''}`),
  ]
  const labels = ['Zoom +', 'Zoom −', 'Fit track', 'Expand 2×', 'Grid']
  viewActions.forEach((control, index) => {
    control.append(element('span', 'editor-action-label', labels[index] ?? 'View'))
    choices.append(control)
  })
  drawer.append(summary, choices)
  history.append(undo, redo, drawer)
  return history
}

export function createEditorStatus(
  state: Pick<AppSnapshot, 'currentTrack' | 'editor' | 'notice'>,
  geometry: TrackGeometry,
): HTMLElement {
  const validation = state.currentTrack
    ? validateTrack({
        ...state.currentTrack,
        routeKind: state.editor.routeKind,
        points: state.editor.points,
        trees: state.editor.trees,
        terrain: state.editor.terrain,
      }, geometry.path.totalLength)
    : undefined
  const status = element(
    'div',
    'status-pill',
    state.notice ??
      validation?.message ??
      `${state.editor.points.length} points · ${state.editor.trees.length} trees`,
  )
  status.setAttribute('role', 'status')
  return status
}

export function createEditorTrackActions(
  actions: Pick<EditorFrameActions, 'save' | 'load' | 'race' | 'edit'>,
): HTMLElement {
  const editorActions = element('div', 'editor-actions')
  const controls = [
    editorIconButton('save', 'save-track', 'Save track', actions.save),
    editorIconButton('clear', 'clear-track', 'Clear track',
      () => actions.edit({ type: 'clear' }), 'icon-button danger'),
    editorIconButton('load', 'load-track', 'Load track', actions.load),
    editorIconButton('race', 'editor-race', 'Race', actions.race, 'icon-button accent'),
  ]
  const labels = ['Save', 'Clear', 'Open', 'Race']
  controls.forEach((control, index) => {
    control.append(element('span', 'editor-action-label', labels[index] ?? ''))
    editorActions.append(control)
  })
  return editorActions
}

export function createEditorDiagnostics(
  state: Pick<AppSnapshot, 'currentTrack' | 'editor'>,
  actions: Pick<EditorFrameActions, 'edit'>,
  geometry: TrackGeometry,
): HTMLElement | undefined {
  if (!state.currentTrack) return undefined
  const diagnostics = analyzeTrack({
    ...state.currentTrack,
    routeKind: state.editor.routeKind,
    points: state.editor.points,
    trees: state.editor.trees,
    terrain: state.editor.terrain,
    ...(state.editor.start ? { start: state.editor.start } : {}),
  }, geometry)
  if (diagnostics.length === 0) return undefined

  const panel = element('aside', 'diagnostic-panel')
  panel.setAttribute('aria-label', 'Track diagnostics')
  panel.append(
    element(
      'strong',
      'point-control-title',
      `${diagnostics.length} geometry ${diagnostics.length === 1 ? 'issue' : 'issues'}`,
    ),
  )
  for (const diagnostic of diagnostics.slice(0, 3)) {
    const row = element('div', `diagnostic-row ${diagnostic.severity}`)
    row.append(
      element('span', 'diagnostic-message', diagnostic.message),
      button(
          diagnostic.repair.type === 'remove-road-after-closed-circuit' ? 'Remove extra road' : 'Repair',
        `repair-${diagnostic.id}`,
        () =>
          actions.edit({
            type: 'apply-track-repair',
            repair: diagnostic.repair,
          }),
        'diagnostic-repair',
      ),
    )
    panel.append(row)
  }
  return panel
}
