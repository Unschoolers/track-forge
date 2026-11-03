import type { AppSnapshot } from '@/application/appState'
import type { EditorCommand } from '@/domain/editor/editorState'
import type { EditorCameraAction } from '@/domain/editor/editorGeometry'
import { analyzeTrack } from '@/domain/track/trackDiagnostics'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { validateTrack } from '@/domain/track/trackValidation'
import { button, element } from '@/ui/dom'

export interface EditorFrameActions {
  readonly home: () => void
  readonly race: () => void
  readonly menu: () => void
  readonly rename: () => void
  readonly save: () => void
  readonly load: () => void
  readonly camera: (action: EditorCameraAction) => void
  readonly toggleGrid: () => void
  readonly edit: (command: EditorCommand) => void
}

export function createEditorTopbar(
  state: Pick<AppSnapshot, 'currentTrack'>,
  actions: Pick<EditorFrameActions, 'home' | 'menu' | 'rename'>,
): HTMLElement {
  const topbar = element('header', 'topbar')
  topbar.append(
    button('⌂', 'home', actions.home, 'icon-button'),
    button(
      state.currentTrack?.name ?? 'NO TRACK',
      'rename-track',
      actions.rename,
      'topbar-title title-button',
    ),
    button('☰', 'editor-menu', actions.menu, 'icon-button'),
  )
  return topbar
}

export function createEditorHistoryActions(
  state: Pick<AppSnapshot, 'editorUi'>,
  actions: Pick<EditorFrameActions, 'camera' | 'edit' | 'toggleGrid'>,
): HTMLElement {
  const history = element('div', 'history-actions')
  history.append(
    button('↶', 'undo', () => actions.edit({ type: 'undo' }), 'icon-button'),
    button('↷', 'redo', () => actions.edit({ type: 'redo' }), 'icon-button'),
    button('＋', 'zoom-in', () => actions.camera('zoom-in'), 'icon-button'),
    button('－', 'zoom-out', () => actions.camera('zoom-out'), 'icon-button'),
    button('⌗', 'fit-track', () => actions.camera('fit'), 'icon-button'),
    button(
      '2×',
      'expand-track',
      () => actions.edit({ type: 'expand', factor: 2 }),
      'icon-button',
    ),
    button(
      '#',
      'toggle-grid',
      actions.toggleGrid,
      `icon-button${state.editorUi.grid ? ' active' : ''}`,
    ),
  )
  return history
}

export function createEditorStatus(
  state: Pick<AppSnapshot, 'currentTrack' | 'editor' | 'notice'>,
  geometry: TrackGeometry,
): HTMLElement {
  const validation = state.currentTrack
    ? validateTrack({
        ...state.currentTrack,
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
  editorActions.append(
    button('▣', 'save-track', actions.save, 'icon-button'),
    button(
      '⌫',
      'clear-track',
      () => actions.edit({ type: 'clear' }),
      'icon-button danger',
    ),
    button('▤', 'load-track', actions.load, 'icon-button'),
    button('▶', 'editor-race', actions.race, 'icon-button accent'),
  )
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
        'Repair',
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
