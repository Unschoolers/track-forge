import { CURATED_CUP_TRACK_IDS, DEFAULT_CUP_TRACK_IDS, MAX_CUP_ROUNDS, cupRoundCount } from '@/application/race/circuitCup'
import type { AppSnapshot } from '@/application/appState'
import { OFFICIAL_COURSES } from '@/domain/track/officialCircuits'
import { button, element } from '@/ui/dom'
import { createModalFrame } from './modalFrame'

export interface CupMenuActions {
  readonly close: () => void
  readonly addTrack: () => void
  readonly loadCurated: () => void
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
  const tracks = [...state.tracks, ...OFFICIAL_COURSES.map(({ track }) => track)]
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
  const lineupHeading = element('h3', 'cup-lineup-heading', 'Track lineup')
  lineupHeading.id = 'cup-lineup-heading'
  list.setAttribute('aria-labelledby', lineupHeading.id)
  const lineupCount = element('span', 'cup-lineup-count', `${lineup.length} of ${MAX_CUP_ROUNDS} rounds`)
  lineupHeading.append(lineupCount)
  frame.body.append(lineupHeading, list)
  const curated = button('LOAD CURATED CUP', 'cup-load-curated', actions.loadCurated, 'button cup-secondary-action')
  curated.setAttribute('aria-pressed', String(lineup.length === CURATED_CUP_TRACK_IDS.length &&
    lineup.every((id, index) => id === CURATED_CUP_TRACK_IDS[index])))
  frame.body.append(curated, element('p', 'cup-format-note',
    'Three stages: Kids Room tight turns, City Harbor speed and braking, then a Rally point-to-point finale.'))
  const add = button('Add track', 'cup-add-track', actions.addTrack, 'button cup-secondary-action')
  add.disabled = lineup.length >= MAX_CUP_ROUNDS
  frame.body.append(add)
  if (checkpoint) {
    const progress = element('p', 'cup-checkpoint-note',
      `Unfinished cup · Race ${Math.min(checkpoint.index + 1, cupRoundCount(checkpoint))} of ${cupRoundCount(checkpoint)}. Its original lineup is preserved.`)
    progress.setAttribute('role', 'status')
    frame.body.append(progress)
  }
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
