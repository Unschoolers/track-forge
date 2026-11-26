import type { RouteKind } from '@/domain/model'
import { SCENERY_KINDS_BY_ENVIRONMENT, type TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { getTrackEnvironment } from '@/presentation/environments'
import { button, element } from '@/ui/dom'
import { iconAction } from '@/ui/components/trackActionButton'
import { createModalFrame } from '@/ui/modals/modalFrame'

function settingSelect<Value extends string>(
  label: string, action: string, selected: Value,
  choices: readonly { value: Value; label: string }[],
  onChange: (value: Value) => void,
): HTMLElement {
  const row = element('label', 'editor-menu-setting')
  const select = element('select', 'editor-menu-select')
  select.dataset.action = action
  select.setAttribute('aria-label', label)
  for (const choice of choices) {
    const option = element('option', '', choice.label)
    option.value = choice.value
    select.append(option)
  }
  select.value = selected
  select.addEventListener('change', () => {
    const choice = choices.find(item => item.value === select.value)
    if (choice) onChange(choice.value)
  })
  row.append(element('span', '', label), select)
  return row
}

export function createEditorMenuModal(
  trackName: string, environmentId: TrackEnvironmentId, routeKind: RouteKind, actions: {
    readonly close: () => void
    readonly share: () => void
    readonly save: () => void
    readonly race: () => void
    readonly saveAs: () => void
    readonly rename: () => void
    readonly home: () => void
    readonly setRouteKind: (routeKind: RouteKind) => void
    readonly setEnvironment: (environmentId: TrackEnvironmentId) => void
  },
  readOnly = false,
): HTMLElement {
  const frame = createModalFrame('Editor menu',
    readOnly ? 'This shared original is read-only. Save a new copy to edit it.' : '',
    actions.close, 'editor-menu-modal')
  const identity = element('div', 'editor-menu-identity')
  const name = element('div', 'editor-menu-name')
  name.append(element('span', 'name-label', 'Track name'), element('strong', '', trackName))
  const share = iconAction('SHARE', 'share', 'menu-share', actions.share)
  identity.append(name)
  if (!readOnly) identity.append(iconAction('RENAME TRACK', 'edit', 'menu-rename', actions.rename))
  identity.append(share)
  const secondary = element('div', 'editor-menu-secondary')
  const saveAs = button('SAVE AS NEW TRACK', 'menu-save-as', actions.saveAs, readOnly ? 'button button-primary' : 'button')
  if (!readOnly) secondary.append(saveAs)
  secondary.append(button('RACE TRACK', 'menu-race', actions.race))
  const ids = Object.keys(SCENERY_KINDS_BY_ENVIRONMENT) as TrackEnvironmentId[]
  const settings = element('section', 'editor-menu-settings')
  settings.append(
    element('h3', 'results-heading', 'Track settings'),
    settingSelect('Environment', 'menu-environment', environmentId,
      ids.map(id => ({ value: id, label: getTrackEnvironment(id).label })), actions.setEnvironment),
    settingSelect<RouteKind>('Route type', 'menu-route-kind', routeKind,
      [{ value: 'circuit', label: 'Circuit' }, { value: 'point-to-point', label: 'Point to point' }],
      actions.setRouteKind),
  )
  frame.body.classList.add('editor-menu-content')
  frame.body.append(
    identity,
    readOnly ? saveAs : button('SAVE TRACK', 'menu-save', actions.save, 'button button-primary'),
    secondary,
  )
  if (!readOnly) frame.body.append(settings)
  frame.body.append(button('RETURN HOME', 'editor-home', actions.home, 'button button-danger'))
  return frame.overlay
}
