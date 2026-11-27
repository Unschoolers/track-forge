import { TREE_SEASONS, type TreeSeason } from '@/domain/track/treeSeason'
import { MAX_SCENERY_SCALE, MIN_SCENERY_SCALE, sceneryScale, SCENERY_SCALE_STEP, type ScenerySelection, type SceneryTransform } from '@/domain/track/sceneryTransform'
import type { AppSnapshot } from '@/application/appState'
import type { EditorCommand } from '@/domain/editor/editorState'
import { planPointInsertion } from '@/domain/editor/editorGeometry'
import type { TrackCrossing } from '@/domain/track/crossings'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { button, element } from '@/ui/dom'
import { editorIconButton } from '@/ui/editor/editorIcons'

export function createEditorSelectionPanels(
  state: AppSnapshot,
  actions: { readonly edit: (command: EditorCommand) => void; readonly dismissScenery: () => void; readonly previewSceneryRotation?: (target: ScenerySelection, rotation: number | null) => void },
  geometry: TrackGeometry,
): readonly HTMLElement[] {
  const panels: HTMLElement[] = []
  const gestureFinished = state.editor.gestureStart === null
  const selectedCrossing = state.editorUi.selectedCrossing
    ? geometry.crossings.find(
        (crossing) => crossing.key === state.editorUi.selectedCrossing,
      )
    : undefined
  if (gestureFinished && selectedCrossing) {
    panels.push(createCrossingControl(selectedCrossing, actions.edit))
  }

  const selectedPoint =
    state.editorUi.selectedPoint === null
      ? undefined
      : state.editor.points[state.editorUi.selectedPoint]
  // The panel can cover the point under the finger as soon as it opens.
  if (gestureFinished && selectedPoint && state.editorUi.selectedPoint !== null) {
    panels.push(
      createPointControl(
        selectedPoint,
        state.editorUi.selectedPoint,
        state.editor.points,
        actions.edit,
      ),
    )
  }

  const target = state.editorUi.selectedScenery
  if (gestureFinished && state.editorUi.tool === 'tree' && target) {
    const item = target.type === 'tree' ? state.editor.trees[target.index] : state.editor.scenery[target.index]
    if (item) panels.push(createSceneryControl(target, item, actions.edit, actions.dismissScenery, actions.previewSceneryRotation))
  }

  if (state.editorUi.tool === 'start' && state.editor.routeKind === 'circuit') {
    panels.push(createStartControl(state, actions.edit))
  }
  return panels
}

function createSceneryControl(
  target: ScenerySelection,
  item: SceneryTransform & { readonly season?: TreeSeason },
  edit: (command: EditorCommand) => void,
  dismiss: () => void,
  preview?: (target: ScenerySelection, rotation: number | null) => void,
): HTMLElement {
  const panel = element('aside', 'point-control scenery-control')
  panel.setAttribute('aria-label', 'Scenery transformation')
  const header = element('div', 'scenery-control-header')
  header.append(
    element('strong', 'point-control-title', 'Scenery transformation'),
    editorIconButton('close', 'close-scenery-control', 'Close scenery transformation', dismiss, 'icon-button scenery-control-close'),
  )
  panel.append(header)
  if (target.type === 'tree') {
    const seasonLabel = element('label', 'point-tension-label scenery-season-label')
    const seasonText = element('span', '')
    const season = document.createElement('input')
    season.type = 'range'
    season.min = '0'
    season.max = String(TREE_SEASONS.length - 1)
    season.step = '1'
    season.value = String(TREE_SEASONS.indexOf(item.season ?? 'summer'))
    season.dataset.action = 'tree-season'
    season.setAttribute('aria-label', 'Tree season')
    const showSeason = () => {
      const value = TREE_SEASONS[Number(season.value)]
      if (!value) return
      const name = value.charAt(0).toUpperCase() + value.slice(1)
      seasonText.textContent = `Season: ${name}`
      season.setAttribute('aria-valuetext', name)
    }
    showSeason()
    season.addEventListener('input', showSeason)
    season.addEventListener('change', () => {
      const value = TREE_SEASONS[Number(season.value)]
      if (value) edit({ type: 'set-tree-season', index: target.index, season: value })
    })
    seasonLabel.append(seasonText, season)
    panel.append(seasonLabel)
  }
  const update = (rotation: number, scale: number) => edit({
    type: 'transform-scenery', target, transform: { rotation, scale },
  })
  const angle = item.rotation ?? 0
  const scale = sceneryScale(item)
  const rotationLabel = element('label', 'point-tension-label')
  const rotationText = element('span', '', `Rotation: ${angle}°`)
  rotationLabel.append(rotationText)
  const rotation = document.createElement('input')
  rotation.type = 'range'
  rotation.min = '0'
  rotation.max = '360'
  rotation.step = '1'
  rotation.value = String(angle)
  rotation.dataset.action = 'scenery-rotation'
  rotation.addEventListener('input', () => {
    rotationText.textContent = `Rotation: ${rotation.value}°`
    preview?.(target, Number(rotation.value))
  })
  const cancelPreview = () => {
    rotation.value = String(angle)
    rotationText.textContent = `Rotation: ${angle}°`
    preview?.(target, null)
  }
  rotation.addEventListener('pointercancel', cancelPreview)
  rotation.addEventListener('blur', cancelPreview)
  rotation.addEventListener('change', () => {
    const value = Number(rotation.value) % 360
    update(value, scale)
    // A no-op commit (e.g. 360° from 0°) must also clear the preview.
    preview?.(target, null)
    rotation.value = String(value)
    rotationText.textContent = `Rotation: ${value}°`
  })
  rotationLabel.append(rotation)
  const sizeLabel = element('label', 'point-tension-label scenery-size-label')
  const sizeText = element('span', '', `Size: ${Math.round(scale * 100)}%`)
  const size = document.createElement('input')
  size.type = 'range'
  size.min = String(Math.round(MIN_SCENERY_SCALE * 100))
  size.max = String(Math.round(MAX_SCENERY_SCALE * 100))
  size.step = String(Math.round(SCENERY_SCALE_STEP * 100))
  size.value = String(Math.round(scale * 100))
  size.dataset.action = 'scenery-scale'
  size.setAttribute('aria-label', 'Scenery size')
  size.setAttribute('aria-valuetext', `${size.value}%`)
  size.addEventListener('input', () => {
    sizeText.textContent = `Size: ${size.value}%`
    size.setAttribute('aria-valuetext', `${size.value}%`)
  })
  size.addEventListener('change', () => update(angle, Number(size.value) / 100))
  sizeLabel.append(sizeText, size)
  panel.append(rotationLabel, sizeLabel, button('Reset', 'scenery-transform-reset', () => update(0, 1), 'point-insert'))
  return panel
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
  // Commit after the thumb is released: dispatching on input rebuilds the panel mid-drag.
  tension.addEventListener('change', () => {
    edit({
      type: 'set-point-tension',
      index,
      tension: Number(tension.value),
    })
  })
  tensionLabel.append(tension)
  const next = points[index + 1]
  panel.append(choices, tensionLabel)
  if (next) {
    const insert = button(
      'Insert after',
      'insert-point',
      () => {
        const insertion = planPointInsertion(points, index, {
          x: (point.x + next.x) / 2,
          y: (point.y + next.y) / 2,
        })
        if (insertion) edit({ type: 'insert-point', ...insertion })
      },
      'point-insert',
    )
    panel.append(insert)
  }
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
