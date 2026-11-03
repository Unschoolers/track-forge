import type { AppSnapshot } from '@/application/appState'
import type { EditorCommand } from '@/domain/editor/editorState'
import type { TrackCrossing } from '@/domain/track/crossings'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { button, element } from '@/ui/dom'

export function createEditorSelectionPanels(
  state: AppSnapshot,
  actions: { readonly edit: (command: EditorCommand) => void },
  geometry: TrackGeometry,
): readonly HTMLElement[] {
  const panels: HTMLElement[] = []
  const selectedCrossing = state.editorUi.selectedCrossing
    ? geometry.crossings.find(
        (crossing) => crossing.key === state.editorUi.selectedCrossing,
      )
    : undefined
  if (selectedCrossing) {
    panels.push(createCrossingControl(selectedCrossing, actions.edit))
  }

  const selectedPoint =
    state.editorUi.selectedPoint === null
      ? undefined
      : state.editor.points[state.editorUi.selectedPoint]
  if (selectedPoint && state.editorUi.selectedPoint !== null) {
    panels.push(
      createPointControl(
        selectedPoint,
        state.editorUi.selectedPoint,
        state.editor.points,
        actions.edit,
      ),
    )
  }

  if (state.editorUi.tool === 'start') {
    panels.push(createStartControl(state, actions.edit))
  }
  return panels
}

function createStartControl(
  state: AppSnapshot,
  edit: (command: EditorCommand) => void,
): HTMLElement {
  const panel = element('aside', 'start-control')
  panel.setAttribute('aria-label', 'Race start')
  panel.append(
    element('strong', 'point-control-title', 'Race start'),
    element('span', 'start-control-help', 'Tap the road to place the line.'),
    button(
      state.editor.start?.reversed ? 'Direction: reverse' : 'Direction: forward',
      'reverse-track-direction',
      () => edit({ type: 'reverse-track-direction' }),
      'point-insert',
    ),
  )
  return panel
}

function createPointControl(
  point: AppSnapshot['editor']['points'][number],
  index: number,
  points: AppSnapshot['editor']['points'],
  edit: (command: EditorCommand) => void,
): HTMLElement {
  const panel = element('aside', 'point-control')
  panel.setAttribute('aria-label', 'Curve point')
  panel.append(element('strong', 'point-control-title', `Point ${index + 1}`))
  const choices = element('div', 'point-control-choices')
  for (const curve of ['smooth', 'corner'] as const) {
    const active = (point.curve ?? 'smooth') === curve
    const control = button(
      curve === 'smooth' ? 'Smooth' : 'Corner',
      `point-${curve}`,
      () => edit({ type: 'set-point-curve', index, curve }),
      `point-choice${active ? ' active' : ''}`,
    )
    control.setAttribute('aria-pressed', String(active))
    choices.append(control)
  }
  const tensionLabel = element('label', 'point-tension-label', 'Tension')
  const tension = document.createElement('input')
  tension.type = 'range'
  tension.min = '0'
  tension.max = '1'
  tension.step = '0.05'
  tension.value = String(point.tension ?? 0.5)
  tension.dataset.action = 'point-tension'
  tension.addEventListener('input', () => {
    edit({
      type: 'set-point-tension',
      index,
      tension: Number(tension.value),
    })
  })
  tensionLabel.append(tension)
  const next = points[(index + 1) % points.length]
  const insert = button(
    'Insert after',
    'insert-point',
    () => {
      if (!next) return
      edit({
        type: 'insert-point',
        index: index + 1,
        point: {
          x: (point.x + next.x) / 2,
          y: (point.y + next.y) / 2,
          surface: point.surface,
          curve: 'smooth',
          tension: 0.5,
        },
      })
    },
    'point-insert',
  )
  panel.append(choices, tensionLabel, insert)
  return panel
}

function createCrossingControl(
  crossing: TrackCrossing,
  edit: (command: EditorCommand) => void,
): HTMLElement {
  const panel = element('aside', 'crossing-control')
  panel.dataset.crossingControl = crossing.key
  panel.setAttribute('aria-label', 'Junction crossing')
  panel.append(element('strong', 'crossing-control-title', 'Junction crossing'))
  const choices = element('div', 'crossing-control-choices')
  const direction = (tangent: { readonly x: number; readonly y: number }) => {
    const directions = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'] as const
    const angle = Math.atan2(tangent.y, tangent.x)
    return directions[
      (Math.round((angle / (Math.PI * 2)) * 8) + 8) % 8
    ] ?? '→'
  }
  const choose = (
    label: string,
    value: 'surface' | 'first' | 'second',
    upperSegment: number | null,
  ): HTMLButtonElement => {
    const active = crossing.upperSegment === upperSegment
    const control = button(
      label,
      `crossing-${value}`,
      () =>
        edit({
          type: 'set-crossing-sections',
          firstSegment: crossing.firstSegment,
          secondSegment: crossing.secondSegment,
          upperSegment,
        }),
      `crossing-choice${active ? ' active' : ''}`,
    )
    control.dataset.crossingLayer = value
    control.setAttribute('aria-pressed', String(active))
    return control
  }
  choices.append(
    choose('Surface', 'surface', null),
    choose(
      `${crossing.firstSurface} ${direction(crossing.firstTangent)} above`,
      'first',
      crossing.firstSegment,
    ),
    choose(
      `${crossing.secondSurface} ${direction(crossing.secondTangent)} above`,
      'second',
      crossing.secondSegment,
    ),
  )
  panel.append(choices)
  return panel
}
