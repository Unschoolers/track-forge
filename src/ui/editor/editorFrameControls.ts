import type { AppSnapshot } from '@/application/appState'
import type { EditorCommand } from '@/domain/editor/editorState'
import type { EditorCameraAction } from '@/domain/editor/editorGeometry'
import { analyzeTrack } from '@/domain/track/trackDiagnostics'
import type { TrackDiagnostic } from '@/domain/track/trackDiagnostics'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { validateTrack } from '@/domain/track/trackValidation'
import { isSharedTrack } from '@/domain/track/trackAccess'
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

export interface EditorDiagnosticsMemo {
  get(
    state: Pick<AppSnapshot, 'currentTrack' | 'editor'>,
    geometry: TrackGeometry,
  ): readonly TrackDiagnostic[]
  clear(): void
}

/** Keeps the latest analysis for one editor chrome lifetime. */
export function createEditorDiagnosticsMemo(): EditorDiagnosticsMemo {
  let previous: {
    readonly track: AppSnapshot['currentTrack']
    readonly points: AppSnapshot['editor']['points']
    readonly trees: AppSnapshot['editor']['trees']
    readonly terrain: AppSnapshot['editor']['terrain']
    readonly start: AppSnapshot['editor']['start']
    readonly routeKind: AppSnapshot['editor']['routeKind']
    readonly geometry: TrackGeometry
    readonly diagnostics: readonly TrackDiagnostic[]
  } | undefined

  const analyze = (
    state: Pick<AppSnapshot, 'currentTrack' | 'editor'>,
    geometry: TrackGeometry,
  ): readonly TrackDiagnostic[] => {
    const currentTrack = state.currentTrack
    if (!currentTrack) return []
    return analyzeTrack(editorDiagnosticTrack(state, currentTrack), geometry)
  }

  return {
    clear() {
      previous = undefined
    },
    get(state, geometry) {
      const { currentTrack, editor } = state
      if (!currentTrack) return []
      if (
        previous?.track === currentTrack &&
        previous.points === editor.points &&
        previous.trees === editor.trees &&
        previous.terrain === editor.terrain &&
        previous.start === editor.start &&
        previous.routeKind === editor.routeKind &&
        previous.geometry === geometry
      ) {
        return previous.diagnostics
      }

      const diagnostics = analyze(state, geometry)
      previous = {
        track: currentTrack,
        points: editor.points,
        trees: editor.trees,
        terrain: editor.terrain,
        start: editor.start,
        routeKind: editor.routeKind,
        geometry,
        diagnostics,
      }
      return diagnostics
    },
  }
}

function editorDiagnosticTrack(
  state: Pick<AppSnapshot, 'currentTrack' | 'editor'>,
  currentTrack: NonNullable<AppSnapshot['currentTrack']>,
) {
  return {
    ...currentTrack,
    routeKind: state.editor.routeKind,
    points: state.editor.points,
    trees: state.editor.trees,
    terrain: state.editor.terrain,
    ...(state.editor.start ? { start: state.editor.start } : {}),
  }
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
  readOnly = false,
): HTMLElement {
  const history = element('div', 'history-actions')
  history.setAttribute('aria-label', readOnly ? 'View tools' : 'History and view tools')
  if (!readOnly) {
    const undo = editorIconButton('undo', 'undo', 'Undo', () => actions.edit({ type: 'undo' }))
    const redo = editorIconButton('redo', 'redo', 'Redo', () => actions.edit({ type: 'redo' }))
    undo.append(element('span', 'editor-action-label', 'Undo'))
    redo.append(element('span', 'editor-action-label', 'Redo'))
    history.append(undo, redo)
  }

  const drawer = element('details', 'editor-view-drawer')
  const summary = element('summary', 'editor-view-summary')
  summary.append(editorIcon('fit'), element('span', '', 'VIEW'))
  const choices = element('div', 'editor-view-items')
  const viewActions = [
    editorIconButton('zoom-in', 'zoom-in', 'Zoom in', () => actions.camera('zoom-in')),
    editorIconButton('zoom-out', 'zoom-out', 'Zoom out', () => actions.camera('zoom-out')),
    editorIconButton('fit', 'fit-track', 'Fit track', () => actions.camera('fit')),
    ...(!readOnly ? [editorIconButton('expand', 'expand-track', 'Expand track 2×',
      () => actions.edit({ type: 'expand', factor: 2 }))] : []),
    editorIconButton('grid', 'toggle-grid', 'Toggle grid', actions.toggleGrid,
      `icon-button${state.editorUi.grid ? ' active' : ''}`),
  ]
  const labels = ['Zoom +', 'Zoom −', 'Fit track', ...(!readOnly ? ['Expand 2×'] : []), 'Grid']
  viewActions.forEach((control, index) => {
    control.append(element('span', 'editor-action-label', labels[index] ?? 'View'))
    choices.append(control)
  })
  drawer.append(summary, choices)
  history.append(drawer)
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
        ...(state.editor.start ? { start: state.editor.start } : {}),
        recoveryCheckpoints: state.editor.recoveryCheckpoints,
      }, geometry.path.totalLength, geometry.path)
    : undefined
  const status = element(
    'div',
    'status-pill',
    state.notice ?? (isSharedTrack(state.currentTrack) ? 'Shared original · read-only' : undefined) ??
      validation?.message ??
      `${state.editor.points.length} points · ${state.editor.trees.length} trees`,
  )
  status.setAttribute('role', 'status')
  return status
}

export function createEditorTrackActions(
  actions: Pick<EditorFrameActions, 'save' | 'load' | 'race' | 'edit'>,
  readOnly = false,
): HTMLElement {
  const editorActions = element('div', 'editor-actions')
  const controls = [
    editorIconButton('save', readOnly ? 'save-as-track' : 'save-track',
      readOnly ? 'Save as new track' : 'Save track', actions.save),
    ...(!readOnly ? [editorIconButton('clear', 'clear-track', 'Clear track',
      () => actions.edit({ type: 'clear' }), 'icon-button danger')] : []),
    editorIconButton('load', 'load-track', 'Load track', actions.load),
    editorIconButton('race', 'editor-race', 'Race', actions.race, 'icon-button accent'),
  ]
  const labels = readOnly ? ['Save As', 'Open', 'Race'] : ['Save', 'Clear', 'Open', 'Race']
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
  memo?: EditorDiagnosticsMemo,
): HTMLElement | undefined {
  if (!state.currentTrack) return undefined
  const diagnostics = memo?.get(state, geometry) ??
    analyzeTrack(editorDiagnosticTrack(state, state.currentTrack), geometry)
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
