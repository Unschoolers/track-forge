import { cupTrackIds, cupRoundCount } from '@/application/race/circuitCup'
import { courseIdentity, nextMedalTarget, scoreCategoryLabel, timeMedal } from '@/application/race/raceRecords'
import { OFFICIAL_CIRCUITS, OFFICIAL_COURSES } from '@/domain/track/officialCircuits'
import type { AppSnapshot } from '@/application/appState'
import { element } from '@/ui/dom'
import { createMenuAction } from '@/ui/menu/menuControls'
import { createMenuDock, createMenuLayout } from '@/ui/menu/menuLayout'
import { formatRaceTime } from '@/ui/format'

export function createHomeScreen(
  state: AppSnapshot,
  actions: {
    readonly edit: () => void
    readonly race: () => void
    readonly raceAgain: () => void
    readonly nearby?: (() => void) | undefined
    readonly cup?: () => void
    readonly options: () => void
    readonly updates?: (() => void) | undefined
  },
): HTMLElement {
  const { root: screen, media, header, content, actions: footer } = createMenuLayout('static')
  screen.classList.add('screen', 'home-screen')
  screen.dataset.screen = 'home'

  const trackArt = element('div', 'home-artwork')
  trackArt.setAttribute('aria-hidden', 'true')
  media.append(trackArt)

  const eyebrow = element('p', 'home-eyebrow', 'BUILD IT · RACE IT · MASTER IT')
  const title = element('h1', 'home-title')
  title.setAttribute('aria-label', 'Track Forge')
  title.append(element('span', 'home-brand-track', 'TRACK'), element('span', 'home-brand-accent', 'FORGE'))
  header.append(eyebrow, title)

  const track = state.currentTrack
  const best = track ? state.scoresByTrack[track.id]?.[0] : undefined
  const details = element('section', 'home-track')
  details.setAttribute('aria-label', 'Current track')
  details.append(
    element('span', 'home-track-label', 'CURRENT TRACK'),
    element('h2', 'home-track-name', track?.name ?? 'No track selected'),
  )
  if (track) {
    details.append(element('p', 'home-track-credit', `Made by ${track.creator?.name ?? (track.id.startsWith('official-') ? 'Track Forge' : 'Unknown')}`))
    details.append(element('p', 'home-track-best', `Best time: ${best ? `${formatRaceTime(best.time)} (${scoreCategoryLabel(best)}${best.category && best.category.course !== courseIdentity(track) ? ' · past layout' : ''})` : 'no time yet'}`))
  } else {
    details.append(element('p', 'home-track-best', 'Create your first circuit'))
  }
  if (state.cupProgress?.bestPlacement) details.append(element('p', 'home-track-progress', `Best Cup placement: ${state.cupProgress.bestPlacement}`))
  const checkpoint = state.cupProgress?.checkpoint
  if (checkpoint) {
    const nextIndex = Math.min(checkpoint.index + (checkpoint.rounds.length > checkpoint.index ? 1 : 0), cupRoundCount(checkpoint) - 1)
    const id = cupTrackIds(checkpoint)[nextIndex]
    const next = [...state.tracks, ...OFFICIAL_COURSES.map(({ track: course }) => course)].find(candidate => candidate.id === id)
    details.append(element('p', 'home-track-progress', checkpoint.rounds.length === cupRoundCount(checkpoint) ? 'Cup standings ready' : `Next Cup round: ${next?.name ?? 'Track unavailable'}`))
  } else {
    const circuit = OFFICIAL_CIRCUITS.map(({ track: course }) => ({ track: course, next: nextMedalTarget(course, timeMedal(course, state.scoresByTrack[course.id] ?? [])) })).find(({ next: target }) => target)
    if (circuit?.next) details.append(element('p', 'home-track-progress', `Next target: ${circuit.track.name} · ${circuit.next.tier.toUpperCase()} ${formatRaceTime(circuit.next.time)}`))
  }
  content.append(details)

  const primaryDock = createMenuDock('Race')
  primaryDock.classList.add('home-primary-dock')
  primaryDock.append(createMenuAction('Race', 'race', actions.race, 'primary'))
  if (state.raceAgainTrackName) {
    const label = `Race again · ${state.raceAgainTrackName}`
    const raceAgain = createMenuAction(label, 'race-again', actions.raceAgain)
    raceAgain.setAttribute('aria-label', label)
    raceAgain.replaceChildren(
      element('span', 'home-race-again-label', 'Race again'),
      element('span', 'home-race-again-track', state.raceAgainTrackName),
    )
    primaryDock.append(raceAgain)
  }

  const navigationDock = element('nav', 'home-navigation')
  navigationDock.setAttribute('aria-label', 'Main menu')
  if (actions.nearby) navigationDock.append(createMenuAction('Nearby race', 'nearby', actions.nearby))
  if (actions.cup) navigationDock.append(createMenuAction('Cup', 'arcade-cup', actions.cup))
  navigationDock.append(createMenuAction('Track editor', 'editor', actions.edit))
  navigationDock.append(createMenuAction('Options', 'options', actions.options))
  if (actions.updates) navigationDock.append(createMenuAction('Update available', 'open-updates', actions.updates))
  footer.append(primaryDock, navigationDock)
  return screen
}
