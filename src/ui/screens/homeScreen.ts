import type { AppSnapshot } from '@/application/appState'
import { button, element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'

export function createHomeScreen(
  state: AppSnapshot,
  actions: {
    readonly edit: () => void
    readonly race: () => void
    readonly options: () => void
  },
): HTMLElement {
  const screen = element('section', 'screen home-screen')
  screen.dataset.screen = 'home'
  const card = element('div', 'home-card')
  const eyebrow = element('p', 'eyebrow', 'BUILD IT · RACE IT · MASTER IT')
  const title = element('h1', 'brand')
  title.append('TRACK', element('span', 'brand-accent', 'FORGE'))
  const trackCard = element('div', 'current-track')
  const best = state.currentTrack
    ? state.scoresByTrack[state.currentTrack.id]?.[0]
    : undefined
  trackCard.append(
    element('span', 'label', 'CURRENT TRACK'),
    element('strong', 'track-name', state.currentTrack?.name ?? 'No track'),
    element(
      'span',
      'track-meta',
      state.currentTrack
        ? `Best time: ${best ? formatRaceTime(best.time) : 'no time yet'}`
        : 'Create your first circuit',
    ),
  )
  const actionsNode = element('div', 'home-actions')
  actionsNode.append(
    button('RACE', 'race', actions.race, 'button button-primary button-large'),
    button('TRACK EDITOR', 'editor', actions.edit, 'button button-large'),
    button('OPTIONS', 'options', actions.options, 'button button-large'),
  )
  card.append(title, eyebrow, trackCard, actionsNode)
  screen.append(card)
  return screen
}
