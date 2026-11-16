import type { RouteKind } from '@/domain/model'
import { SCENERY_KINDS_BY_ENVIRONMENT, type TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { getTrackEnvironment } from '@/presentation/environments'
import { button, element } from '@/ui/dom'
import { createSegmentedButtons } from '@/ui/editor/editorContextDock'
import { createModalFrame } from '@/ui/modals/modalFrame'

export function createEditorMenuModal(environmentId: TrackEnvironmentId, routeKind: RouteKind, actions: {
  readonly close: () => void
  readonly export: () => void
  readonly save: () => void
  readonly rename: () => void
  readonly choose: () => void
  readonly options: () => void
  readonly home: () => void
  readonly setRouteKind: (routeKind: RouteKind) => void
  readonly setEnvironment: (environmentId: TrackEnvironmentId) => void
}): HTMLElement {
  const frame = createModalFrame(
    'Editor menu',
    'Track and application actions.',
    actions.close,
  )
  const environment = element('section', 'editor-menu-environment')
  const ids = Object.keys(SCENERY_KINDS_BY_ENVIRONMENT) as TrackEnvironmentId[]
  environment.append(
    element('h3', 'results-heading', 'Environment'),
    createSegmentedButtons('Environment', ids.map((id) => ({
      value: id,
      label: getTrackEnvironment(id).label,
      action: `environment-${id}`,
      pressed: environmentId === id,
      data: { environment: id },
      select: () => actions.setEnvironment(id),
    }))),
  )
  frame.body.classList.add('menu-buttons')
  frame.body.append(
    environment,
    element('h3', 'results-heading', 'Route type'),
    createSegmentedButtons('Route type', ([['circuit', 'Circuit'], ['point-to-point', 'Point to point']] as const).map(([value, label]) => ({
      value, label, action: `route-kind-${value}`, pressed: routeKind === value,
      select: () => actions.setRouteKind(value),
    }))),
    element('p', '', 'Point-to-point races start and finish at the road endpoints.'),
    button(
      'SAVE TRACK',
      'menu-save',
      actions.save,
      'button button-primary',
    ),
    button('EXPORT TRACK', 'menu-export', actions.export, 'button'),
    button('RENAME TRACK', 'menu-rename', actions.rename, 'button'),
    button('CHOOSE ANOTHER TRACK', 'menu-choose', actions.choose, 'button'),
    button('OPTIONS', 'editor-options', actions.options, 'button'),
    button(
      'RETURN HOME',
      'editor-home',
      actions.home,
      'button button-danger',
    ),
  )
  return frame.overlay
}
