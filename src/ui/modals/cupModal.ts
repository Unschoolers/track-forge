import { DEFAULT_CUP_TRACK_IDS, MAX_CUP_ROUNDS, cupRoundCount } from '@/application/race/circuitCup'
import type { AppSnapshot } from '@/application/appState'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { button, element } from '@/ui/dom'
import { createModalFrame } from './modalFrame'

export interface CupMenuActions {
  readonly close: () => void
  readonly addTrack: () => void
  readonly removeTrack: (index: number) => void
  readonly moveTrack: (index: number, direction: -1 | 1) => void
  readonly start: () => void
  readonly resume: () => void
  readonly hostNearby?: () => void
}

export function createCupModal(state: AppSnapshot, actions: CupMenuActions): HTMLElement {
  const frame = createModalFrame('CUP', 'Build a series. Race every track. Win the championship.', actions.close, 'cup-modal')
  frame.overlay.dataset.modal = 'cup'
  const lineup = state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS
  const tracks = [...state.tracks, ...OFFICIAL_CIRCUITS.map(({ track }) => track)]
  const checkpoint = state.cupProgress?.checkpoint
  const list = element('ol', 'cup-track-list')
  list.setAttribute('aria-label', 'Cup track order')
  lineup.forEach((id, index) => {
    const track = tracks.find(track => track.id === id)
    const row = element('li', 'cup-track-row')
    const name = element('span', 'cup-track-name', `${index + 1}. ${track?.name ?? 'Missing track'}`)
    if (!track) name.classList.add('cup-track-missing')
    const controls = element('div', 'cup-track-actions')
    const up = button('↑', `cup-up-${index}`, () => actions.moveTrack(index, -1), 'track-mini-button')
    up.setAttribute('aria-label', `Move ${track?.name ?? 'track'} up`)
    up.disabled = index === 0
    const down = button('↓', `cup-down-${index}`, () => actions.moveTrack(index, 1), 'track-mini-button')
    down.setAttribute('aria-label', `Move ${track?.name ?? 'track'} down`)
    down.disabled = index === lineup.length - 1
    const remove = button('×', `cup-remove-${index}`, () => actions.removeTrack(index), 'track-mini-button')
    remove.setAttribute('aria-label', `Remove ${track?.name ?? 'track'}`)
    controls.append(up, down, remove)
    row.append(name, controls)
    list.append(row)
  })
  frame.body.append(element('h3', 'results-heading', `TRACK LINEUP · ${lineup.length}/${MAX_CUP_ROUNDS}`), list)
  const add = button('+ ADD TRACK', 'cup-add-track', actions.addTrack, 'button')
  add.disabled = lineup.length >= MAX_CUP_ROUNDS
  frame.body.append(add)
  if (checkpoint) frame.body.append(element('p', 'modal-subtitle',
    `Unfinished cup · Race ${Math.min(checkpoint.index + 1, cupRoundCount(checkpoint))} of ${cupRoundCount(checkpoint)}. Its original lineup is preserved.`))
  const raceReady = lineup.length > 0 && lineup.every(id => tracks.some(track => track.id === id))
  const hosting = state.overlay.type === 'cup' && state.overlay.returnTo === 'nearby' && !!actions.hostNearby
  const start = button('START NEW CUP', 'start-cup', actions.start, hosting ? 'button' : 'button button-primary')
  start.disabled = !raceReady
  const host = actions.hostNearby
    ? button('HOST NEARBY CUP', 'host-nearby-cup', actions.hostNearby, hosting ? 'button button-primary' : 'button')
    : null
  if (host) host.disabled = !raceReady
  if (hosting && host) frame.footer.append(host)
  if (checkpoint) frame.footer.append(button('RESUME CUP', 'resume-cup', actions.resume, 'button'))
  frame.footer.append(start)
  if (!hosting && host) frame.footer.append(host)
  frame.footer.append(button('BACK', 'cup-back', actions.close, 'button'))
  return frame.overlay
}
