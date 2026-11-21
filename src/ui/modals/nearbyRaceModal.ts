import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import type { RaceResult } from '@/application/race/raceSession'
import { CAR_SPECS } from '@/domain/config'
import type { CarId } from '@/domain/model'
import { createCarPicker } from '@/ui/components/carPicker'
import { button, element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'
import { createModalFrame } from './modalFrame'
import { DEFAULT_PLAYER_IDENTITY, TOPPER_COLORS, TOPPER_ICONS, type PlayerIdentity } from '@/application/multiplayer/playerIdentity'
import { createTopperSelector } from '@/ui/components/playerTopperPicker'

export function createNearbyRaceModal(
  nearby: NearbyRace,
  car: CarId,
  actions: { close: () => void; chooseTrack: () => void; scan: () => void; selectCar: (car: CarId) => void; downloadDiagnostics: () => Promise<boolean>;
    toggleCustomize?: () => void; selectIdentity?: (identity: PlayerIdentity) => void },
  identity: PlayerIdentity = DEFAULT_PLAYER_IDENTITY,
  customizing = false,
): HTMLElement {
  const { phase, room, track, players, canStart, rooms, error } = nearby.snapshot()
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
        createTopperSelector(identity, customizing, actions.toggleCustomize, actions.selectIdentity),
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
      frame.body.append(element('p', 'modal-subtitle', 'Sharing the track with all players…'))
      break
    case 'staging':
      frame.body.append(element('p', 'modal-subtitle', 'Loading everyone into the race…'))
      break
  }
  frame.body.append(createDiagnosticsControl(actions.downloadDiagnostics))
  frame.footer.append(button('BACK', 'nearby-back', actions.close, 'button'))
  return frame.overlay
}

export function createNearbyRaceResults(
  nearby: NearbyRace,
  result: RaceResult,
  home: () => void,
  downloadDiagnostics: () => Promise<boolean>,
) {
  const title = 'NEARBY RACE RESULTS'
  const frame = createModalFrame(title, result.trackName, undefined, 'results-modal')
  frame.overlay.dataset.modal = 'results'
  if (result.playerTime !== null) {
    frame.body.append(element('p', 'modal-subtitle', `Your time · ${formatRaceTime(result.playerTime)}`))
  }
  const list = element('ol', 'scoreboard')
  list.setAttribute('aria-live', 'polite')
  const status = element('p', 'modal-subtitle')
  status.setAttribute('role', 'status')
  function update() {
    status.textContent = nearby.snapshot().error ?? ''
    status.hidden = !status.textContent
    list.replaceChildren(...nearby.standings().map(({ slot, car, identity, local, time, left }, index) => {
      const row = element('li', `scoreboard-row${local ? ' player' : ''}`)
      const label = local ? 'You' : `Player ${slot + 1}`
      const topper = element('span', 'topper-marker', TOPPER_ICONS[identity.icon])
      topper.style.color = '#' + TOPPER_COLORS[identity.color].toString(16).padStart(6, '0')
      topper.title = `${identity.color} ${identity.icon} topper`
      row.append(
        topper,
        element('strong', undefined, `${typeof time === 'number' ? `${index + 1}. ` : ''}${label} · ${CAR_SPECS[car].name}`),
        element('span', undefined, typeof time === 'number' ? formatRaceTime(time) : left ? 'LEFT' : time === null ? 'UNFINISHED' : 'RACING…'),
      )
      return row
    }))
  }
  update()
  frame.body.append(list, status, createDiagnosticsControl(downloadDiagnostics))
  frame.footer.append(button('LEAVE ROOM', 'results-home', home, 'button button-primary'))
  return { element: frame.overlay, cleanup: nearby.subscribe(update) }
}

function createDiagnosticsControl(save: () => Promise<boolean>): HTMLElement {
  const section = element('section', 'setup-section')
  const status = element('p', 'modal-subtitle')
  status.setAttribute('role', 'status')
  const download = button('DOWNLOAD DIAGNOSTICS', 'nearby-download-diagnostics', () => {
    download.disabled = true
    status.textContent = 'Preparing report…'
    void save().then((saved) => {
      status.textContent = saved ? 'Diagnostic report saved.' : ''
    }).catch(() => {
      status.textContent = 'Could not save the diagnostic report. Try again.'
    }).finally(() => {
      download.disabled = false
    })
  }, 'button')
  section.append(download, status)
  return section
}

export function createNearbyRaceMenu(resume: () => void, leave: () => void): HTMLElement {
  const frame = createModalFrame('Nearby Race', 'The race keeps running.', resume, 'nearby-race-modal')
  frame.footer.append(
    button('RESUME', 'resume-race', resume, 'button button-primary'),
    button('LEAVE RACE', 'quit-race', leave, 'button button-danger'),
  )
  return frame.overlay
}
