import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import type { RaceResult } from '@/application/race/raceSession'
import { CAR_SPECS } from '@/domain/config'
import type { CarId } from '@/domain/model'
import { createCarPicker } from '@/ui/components/carPicker'
import { button, element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'
import { createModalFrame } from './modalFrame'

export function createNearbyRaceModal(
  nearby: NearbyRace,
  car: CarId,
  actions: { close: () => void; chooseTrack: () => void; scan: () => void; selectCar: (car: CarId) => void },
): HTMLElement {
  const { phase, room, track, players, canStart, rooms, pairing, error } = nearby.snapshot()
  const frame = createModalFrame('Nearby Race', room ?? 'Arcade · Up to 4 players', actions.close, 'nearby-race-modal')
  frame.body.classList.add('menu-buttons')
  if (error) {
    const message = element('p', 'modal-subtitle', error)
    message.setAttribute('role', 'status')
    frame.body.append(message)
  }
  switch (phase) {
    case 'idle':
      frame.body.append(
        createCarPicker(car, actions.selectCar),
        button('HOST A RACE', 'nearby-choose-track', actions.chooseTrack, 'button'),
        button('FIND A ROOM', 'nearby-scan', actions.scan, 'button button-primary'),
      )
      break
    case 'opening':
      frame.body.append(element('p', 'modal-subtitle', 'Opening nearby room…'))
      break
    case 'hosting': {
      frame.body.append(element('p', 'modal-subtitle', `${track} · ${players}/4 players connected`))
      const start = button('START RACE', 'nearby-start', () => nearby.start(), 'button button-primary')
      start.disabled = !canStart
      frame.footer.append(start)
      break
    }
    case 'scanning':
      frame.body.append(element('p', 'modal-subtitle', rooms.length ? 'Choose a room to join.' : 'Looking for rooms…'))
      for (const [id, name] of rooms) frame.body.append(button(name, `nearby-room-${id}`, () => nearby.connect(id), 'button'))
      break
    case 'connecting':
      frame.body.append(element('p', 'modal-subtitle', 'Connecting…'))
      break
    case 'waiting':
      frame.body.append(element('p', 'modal-subtitle', 'Waiting for the host to start the race.'))
      break
    case 'preparing':
      frame.body.append(element('p', 'modal-subtitle', 'Getting the track ready…'))
      break
  }
  for (const [id, code] of pairing) {
    const pair = element('section', 'setup-section')
    pair.append(element('p', 'modal-subtitle', 'Confirm this code matches the other phone.'),
      element('strong', 'setup-label', code))
    const choices = element('div', 'choice-row')
    choices.append(
      button('MATCHES', `nearby-accept-${id}`, () => nearby.respond(id, true), 'button button-primary'),
      button('DECLINE', `nearby-decline-${id}`, () => nearby.respond(id, false), 'button'),
    )
    pair.append(choices)
    frame.body.append(pair)
  }
  frame.footer.append(button('BACK', 'nearby-back', actions.close, 'button'))
  return frame.overlay
}

export function createNearbyRaceResults(nearby: NearbyRace, result: RaceResult, home: () => void) {
  const title = 'NEARBY RACE RESULTS'
  const frame = createModalFrame(title, result.trackName, undefined, 'results-modal')
  frame.overlay.dataset.modal = 'results'
  if (result.playerTime !== null) {
    frame.body.append(element('p', 'modal-subtitle', `Your time · ${formatRaceTime(result.playerTime)}`))
  }
  const list = element('ol', 'scoreboard')
  list.setAttribute('aria-live', 'polite')
  function update() {
    list.replaceChildren(...nearby.standings().map(({ slot, car, local, time, left }, index) => {
      const row = element('li', `scoreboard-row${local ? ' player' : ''}`)
      const label = local ? 'You' : `Player ${slot + 1}`
      row.append(
        element('strong', undefined, `${typeof time === 'number' ? `${index + 1}. ` : ''}${label} · ${CAR_SPECS[car].name}`),
        element('span', undefined, typeof time === 'number' ? formatRaceTime(time) : left ? 'LEFT' : time === null ? 'UNFINISHED' : 'RACING…'),
      )
      return row
    }))
  }
  update()
  frame.body.append(list)
  frame.footer.append(button('LEAVE ROOM', 'results-home', home, 'button button-primary'))
  return { element: frame.overlay, cleanup: nearby.subscribe(update) }
}

export function createNearbyRaceMenu(resume: () => void, leave: () => void): HTMLElement {
  const frame = createModalFrame('Nearby Race', 'The race keeps running.', resume, 'nearby-race-modal')
  frame.footer.append(
    button('RESUME', 'resume-race', resume, 'button button-primary'),
    button('LEAVE RACE', 'quit-race', leave, 'button button-danger'),
  )
  return frame.overlay
}
