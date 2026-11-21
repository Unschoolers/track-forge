import { CUP_CIRCUITS } from '@/application/race/circuitCup'
import { courseIdentity, nextMedalTarget, scoreCategoryLabel, timeMedal } from '@/application/race/raceRecords'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import type { AppSnapshot } from '@/application/appState'
import { button, element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'

export function createHomeScreen(
  state: AppSnapshot,
  actions: {
    readonly edit: () => void
    readonly race: () => void
    readonly raceAgain: () => void
    readonly nearby?: (() => void) | undefined
    readonly cup?: () => void
    readonly resumeCup?: () => void
    readonly options: () => void
    readonly updates?: (() => void) | undefined
  },
): HTMLElement {
  const screen = element('section', 'screen home-screen')
  screen.dataset.screen = 'home'
  const card = element('div', 'home-card')
  const eyebrow = element('p', 'eyebrow', 'BUILD IT · RACE IT · MASTER IT')
  const title = element('h1', 'brand')
  title.setAttribute('aria-label', 'Track Forge')
  title.append(element('span', 'home-brand-track', 'TRACK'), element('span', 'brand-accent', 'FORGE'))
  const trackCard = element('div', 'current-track')
  const best = state.currentTrack
    ? state.scoresByTrack[state.currentTrack.id]?.[0]
    : undefined
  trackCard.append(
    element('span', 'label', 'CURRENT TRACK'),
    element('strong', 'track-name', state.currentTrack?.name ?? 'No track'),
    ...(state.currentTrack ? [element('span', 'track-meta', `Made by ${state.currentTrack.creator?.name ?? (state.currentTrack.id.startsWith('official-') ? 'Track Forge' : 'Unknown')}`)] : []),
    element(
      'span',
      'track-meta',
      state.currentTrack
        ? `Best time: ${best ? `${formatRaceTime(best.time)} (${scoreCategoryLabel(best)}${best.category && best.category.course !== courseIdentity(state.currentTrack) ? ' · past layout' : ''})` : 'no time yet'}`
        : 'Create your first circuit',
    ),
  )
  if (state.cupProgress?.bestPlacement) trackCard.append(element('span', 'track-meta', `Best Cup placement: ${state.cupProgress.bestPlacement}`))
  const checkpoint = state.cupProgress?.checkpoint
  if (checkpoint) {
    const nextIndex = Math.min(checkpoint.index + (checkpoint.rounds.length > checkpoint.index ? 1 : 0), CUP_CIRCUITS.length - 1)
    trackCard.append(element('span', 'track-meta', checkpoint.rounds.length === CUP_CIRCUITS.length ? 'Cup standings ready' : `Next Cup round: ${CUP_CIRCUITS[nextIndex]?.track.name}`))
  } else {
    const circuit = OFFICIAL_CIRCUITS.map(({ track }) => ({ track, next: nextMedalTarget(track, timeMedal(track, state.scoresByTrack[track.id] ?? [])) })).find(({ next }) => next)
    if (circuit?.next) trackCard.append(element('span', 'track-meta', `Next target: ${circuit.track.name} · ${circuit.next.tier.toUpperCase()} ${formatRaceTime(circuit.next.time)}`))
  }
  const actionsNode = element('div', 'home-actions')
  actionsNode.append(
    ...(state.raceAgainTrackName ? [button(`RACE AGAIN · ${state.raceAgainTrackName}`, 'race-again', actions.raceAgain, 'button button-primary button-large')] : []),
    button('RACE', 'race', actions.race, 'button button-primary button-large'),
    ...(actions.nearby ? [button('NEARBY RACE', 'nearby', actions.nearby, 'button button-large')] : []),
    ...(checkpoint && actions.resumeCup ? [button('RESUME CUP', 'resume-cup', actions.resumeCup, 'button button-large')] : []),
    ...(actions.cup && !checkpoint ? [button('ARCADE CUP', 'arcade-cup', actions.cup, 'button button-large')] : []),
    button('TRACK EDITOR', 'editor', actions.edit, 'button button-large'),
    ...(actions.updates ? [button('UPDATE AVAILABLE', 'open-updates', actions.updates, 'button home-update-button')] : []),
    button('OPTIONS', 'options', actions.options, 'button button-large'),
  )
  const heading = element('header', 'home-heading')
  heading.append(title, eyebrow)
  card.append(heading, actionsNode, trackCard)
  screen.append(card)
  return screen
}
