import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import type { NearbyConnectionModes } from '@/infrastructure/multiplayer/selectNearbyConnection'
import { MAX_PLAYERS } from '@/application/multiplayer/controlProtocol'
import type { RaceResult } from '@/application/race/raceSession'
import { createFinishCelebration, medalForFinish } from '@/ui/components/finishMedal'
import { CAR_SPECS } from '@/domain/config'
import { populateNearbyLobby } from '@/ui/components/nearbyLobbyPanel'
import { button, element } from '@/ui/dom'
import { formatRaceTime, ordinalSuffix } from '@/ui/format'
import { createModalFrame } from './modalFrame'
import { createTopperMarker } from '@/ui/components/playerTopperPicker'

function nearbyRacerLabel(racer: { readonly slot: number; readonly name?: string | undefined; readonly local: boolean }): string {
  return racer.name ? `${racer.name}${racer.local ? ' (You)' : ''}` : racer.local ? 'You' : `Player ${racer.slot + 1}`
}

/** A confirmation is part of the existing Nearby overlay, not a room transition. */
export function createNearbyLeaveConfirmation(
  role: ReturnType<NearbyRace['snapshot']>['role'],
  actions: { stay: () => void; leave: () => void },
): HTMLElement {
  const frame = createModalFrame('Leave room?', 'Multiplayer', actions.stay, 'nearby-race-modal')
  frame.body.append(element('p', 'modal-subtitle', role === 'host'
    ? 'Leaving will close the room for everyone.'
    : 'You will disconnect from the room and miss the next race.'))
  frame.footer.append(
    button('STAY IN ROOM', 'nearby-stay', actions.stay, 'button button-primary'),
    button('LEAVE ROOM', 'nearby-confirm-leave', actions.leave, 'button button-danger'),
  )
  return frame.overlay
}

export function createNearbyRaceModal(
  nearby: NearbyRace,
  actions: { close: () => void; chooseTrack: () => void; configureCup: () => void; scan: () => void; scanTracks: () => void;
    saveTrack: () => void; declineTrack: () => void; connectByIp: (ip: string) => void;
    downloadDiagnostics: () => Promise<boolean>;
  },
  connections?: NearbyConnectionModes,
  preview?: HTMLElement,
): HTMLElement {
  const snapshot = nearby.snapshot()
  const { phase, purpose, room, track, lighting, incomingTrack, sharedCount, shareStatus, players, canStart, rooms, error } = snapshot
  const cup = snapshot.cup
  const frame = createModalFrame(phase === 'lobby' ? 'Race Lobby' : cup ? 'Nearby Cup' : 'Nearby Race',
    phase === 'lobby' ? [track ?? 'Next race', room].filter(Boolean).join(' · ') : room ?? (cup ? `Cup · ${cup.total} tracks · Up to ${MAX_PLAYERS} players` : `Arcade · Up to ${MAX_PLAYERS} players`),
    actions.close, phase === 'lobby' ? 'nearby-race-modal nearby-lobby-modal race-preparation-modal' : 'nearby-race-modal')
  frame.body.classList.add('menu-buttons')
  if (error) {
    const message = element('p', 'modal-subtitle', error)
    message.setAttribute('role', 'status')
    frame.body.append(message)
  }
  switch (phase) {
    case 'idle':
      if (connections) {
        const section = element('section', 'setup-section')
        section.append(element('h3', 'setup-label', 'CONNECTION'))
        const choices = element('div', 'choice-row')
        const message = element('p', 'modal-subtitle')
        const updateChoice = () => {
          const selected = connections.current()
          for (const node of choices.querySelectorAll<HTMLButtonElement>('button[data-mode]')) {
            const active = node.dataset.mode === selected
            node.classList.toggle('active', active)
            node.setAttribute('aria-pressed', String(active))
          }
          message.textContent = connections.choices.find(option => option.mode === selected)?.description ?? ''
        }
        for (const option of connections.choices) {
          const choice = button(option.label, `nearby-mode-${option.mode}`, () => {
            if (connections.choose(option.mode)) updateChoice()
          }, 'setup-choice')
          choice.dataset.mode = option.mode
          choices.append(choice)
        }
        section.append(choices, message)
        updateChoice()
        frame.body.append(section)
      }
      frame.body.append(
        button('CHOOSE TRACK TO HOST', 'nearby-choose-track', actions.chooseTrack, 'button button-primary'),
        button('HOST CUP', 'nearby-host-cup', actions.configureCup, 'button'),
        button('FIND A RACE', 'nearby-scan', actions.scan, 'button'),
        button('RECEIVE TRACK', 'nearby-receive-track', actions.scanTracks, 'button'),
      )
      break
    case 'opening':
      frame.body.append(element('p', 'modal-subtitle', 'Opening nearby room…'))
      break
    case 'hosting': {
      if (connections?.current() === 'lan') {
        const ip = connections.hostAddress()
        frame.body.append(element('p', 'modal-subtitle',
          ip ? `JOIN BY IP · Host address: ${ip} · TCP 47832`
            : 'Local Wi-Fi · Share this device’s Wi-Fi IPv4 address with your friends.'))
      }
      frame.body.append(element('p', 'modal-subtitle',
        `${track} · ${purpose === 'share' ? 'Sharing with' : 'Players'} ${players - 1}/${purpose === 'share' ? 3 : MAX_PLAYERS - 1} nearby friends${cup ? ` · Cup 1/${cup.total}` : ''}`))
      if (purpose === 'share') {
        frame.body.append(element('p', 'modal-subtitle',
          `${sharedCount} friend${sharedCount === 1 ? '' : 's'} saved the track. Keep this screen open to share with more devices.`))
      } else {
        const lightingSection = element('section', 'setup-section')
        lightingSection.append(element('h3', 'setup-label', cup ? 'CUP LIGHTING' : 'RACE LIGHTING'))
        const choices = element('div', 'choice-row')
        for (const value of ['day', 'night'] as const) {
          const choice = button(value.toUpperCase(), `nearby-lighting-${value}`,
            () => nearby.setLighting(value), `setup-choice${lighting === value ? ' active' : ''}`)
          choice.setAttribute('aria-pressed', String(lighting === value))
          choices.append(choice)
        }
        lightingSection.append(choices)
        frame.body.append(lightingSection)
        const start = button('PREPARE RACE', 'nearby-start', () => nearby.start(), 'button button-primary')
        start.disabled = !canStart
        if (!canStart) frame.body.append(element('p', 'modal-subtitle',
          players > 1 ? 'Connecting players…' : 'Waiting for at least one nearby player to join.'))
        frame.footer.append(start)
      }
      break
    }
    case 'scanning': {
      frame.body.append(element('p', 'modal-subtitle', rooms.length ? 'Choose a room to join.' : purpose === 'share' ? 'Looking for nearby track senders…' : 'Looking for races…'))
      for (const [id, name] of rooms) frame.body.append(button(name, `nearby-room-${id}`, () => nearby.connect(id), 'button'))
      if (connections?.current() === 'lan') {
        const section = element('section', 'setup-section')
        section.append(element('h3', 'setup-label', 'CAN’T SEE THE HOST? JOIN BY IP'))
        const hint = element('p', 'modal-subtitle', 'Enter the host device’s Wi-Fi IPv4 address. This bypasses automatic discovery. Windows Firewall must allow TrackForge on private networks.')
        const form = element('form', 'name-form')
        const input = element('input', 'name-input')
        input.type = 'text'
        input.inputMode = 'decimal'
        input.autocomplete = 'off'
        input.maxLength = 15
        input.placeholder = '192.168.1.20'
        input.setAttribute('aria-label', 'LAN host IPv4 address')
        const join = button('JOIN BY IP', 'nearby-connect-ip', () => actions.connectByIp(input.value), 'button button-primary')
        form.addEventListener('submit', event => { event.preventDefault(); actions.connectByIp(input.value) })
        form.append(input, join)
        section.append(hint, form)
        frame.body.append(section)
      }
      break
    }
    case 'connecting':
      frame.body.append(element('p', 'modal-subtitle', 'Connecting…'))
      break
    case 'waiting':
      frame.body.append(element('p', 'modal-subtitle', purpose === 'share'
        ? shareStatus === 'saved' ? 'Track saved to your library. You can leave the sharing room.'
          : shareStatus === 'declined' ? 'Track declined. You can leave the sharing room.'
          : 'Waiting for the track…'
        : 'Waiting for the host to start the race.'))
      break
    case 'lobby':
      populateNearbyLobby(frame, nearby, snapshot, preview)
      break
    case 'preparing':
      frame.body.append(element('p', 'modal-subtitle', purpose === 'share' ? 'Receiving and checking the track…' : 'Sharing the track with all players…'))
      break
    case 'share-review':
      frame.body.append(
        element('h3', 'results-heading', 'INCOMING TRACK'),
        element('p', 'modal-subtitle', incomingTrack ?? 'Track ready'),
        element('p', 'modal-subtitle', 'Save a separate copy to your library?'),
        button('SAVE TRACK', 'nearby-save-track', actions.saveTrack, 'button button-primary'),
        button('DECLINE', 'nearby-decline-track', actions.declineTrack, 'button'),
      )
      break
    case 'staging':
      frame.body.append(element('p', 'modal-subtitle', 'Loading everyone into the race…'))
      break
  }
  if (phase === 'idle' || phase === 'lobby') {
    const details = element('details', phase === 'lobby' ? 'nearby-lobby-diagnostics' : undefined)
    details.append(element('summary', 'modal-subtitle', 'Diagnostics'), createDiagnosticsControl(actions.downloadDiagnostics))
    frame.body.append(details)
  } else frame.body.append(createDiagnosticsControl(actions.downloadDiagnostics))
  frame.footer.append(button(phase === 'lobby' ? 'LEAVE ROOM' : 'BACK', 'nearby-back', actions.close, phase === 'lobby' ? 'button button-danger' : 'button'))
  return frame.overlay
}

export function createNearbyRaceResults(
  nearby: NearbyRace,
  result: RaceResult,
  actions: {
    leave: () => void
    race: () => void
    selectTrack: () => void
    downloadDiagnostics: () => Promise<boolean>
  },
) {
  const firstSnapshot = nearby.snapshot()
  const frame = createModalFrame(firstSnapshot.cup ? 'NEARBY CUP RESULTS' : 'NEARBY RACE RESULTS',
    result.trackName, undefined, 'results-modal')
  frame.overlay.dataset.modal = 'results'
  const title = frame.overlay.querySelector<HTMLElement>('.modal-title')
  const dialog = frame.overlay.querySelector<HTMLElement>('[role="dialog"]')
  const celebration = element('div', 'nearby-celebration')
  let celebrationKey = ''
  if (result.playerTime !== null) {
    frame.body.append(element('p', 'modal-subtitle', `Your time · ${formatRaceTime(result.playerTime)}`))
  }
  const list = element('ol', 'scoreboard')
  list.setAttribute('aria-live', 'polite')
  const status = element('p', 'modal-subtitle')
  status.setAttribute('role', 'status')
  const nextTrack = element('p', 'modal-subtitle')
  const cupScores = element('div', 'nearby-cup-scores')
  const race = nearby.snapshot().role === 'host'
    ? button(firstSnapshot.cup ? 'NEXT CUP RACE' : 'RACE AGAIN', 'nearby-race-again', actions.race, 'button button-primary')
    : null
  const selectTrack = race
    && !firstSnapshot.cup ? button('SELECT TRACK', 'nearby-next-track', actions.selectTrack, 'button')
    : null
  function update() {
    const snapshot = nearby.snapshot()
    const standings = nearby.standings()
    const complete = standings.length > 0 && standings.every(({ time, left }) => time !== undefined || left)
    const localIndex = standings.findIndex(({ local }) => local)
    const localTime = standings[localIndex]?.time
    const winnerTime = standings.find(({ time }) => typeof time === 'number')?.time
    const place = localIndex + 1
    const medal = complete && typeof localTime === 'number' && result.outcome === 'finished'
      ? medalForFinish('finished', place) : null
    const headline = complete
      ? typeof localTime !== 'number'
        ? result.outcome === 'water' ? 'SUNK' : 'DID NOT FINISH'
        : place === 1 ? 'VICTORY!' : `FINISHED ${place}${ordinalSuffix(place)}`
      : snapshot.cup ? 'NEARBY CUP RESULTS' : 'NEARBY RACE RESULTS'
    if (title && title.textContent !== headline) {
      title.textContent = headline
      dialog?.setAttribute('aria-label', headline)
    }
    const key = complete ? `${place}:${medal ?? 'none'}:${localTime}` : 'waiting'
    if (key !== celebrationKey) {
      celebrationKey = key
      const nodes: HTMLElement[] = []
      if (medal) nodes.push(createFinishCelebration(medal), element('p', 'race-finish-medal', `${medal} MEDAL`))
      if (complete && typeof localTime === 'number' && place > 1 &&
          typeof winnerTime === 'number') {
        nodes.push(element('p', 'modal-subtitle', `Behind winner · +${formatRaceTime(Math.max(0, localTime - winnerTime))}`))
      }
      celebration.replaceChildren(...nodes)
    }
    if (snapshot.cup) {
      const { cup } = snapshot
      cupScores.replaceChildren(
        element('h3', 'results-heading', `CUP STANDINGS · ROUND ${cup.index + 1}/${cup.total}`),
        ...cup.standings.map(({ slot, points }, rank) =>
          element('p', 'modal-subtitle', `${rank + 1}. ${nearbyRacerLabel(nearby.standings().find(racer => racer.slot === slot) ?? { slot, local: slot === nearby.localSlot() })} · ${points} pts`)),
      )
    }
    if (snapshot.role === 'host') {
      nextTrack.textContent = snapshot.cup
        ? snapshot.cup.nextTrack ? `Next Cup race · ${snapshot.cup.nextTrack}` : 'Cup complete!'
        : `Next race · ${snapshot.track ?? result.trackName}`
      if (race) race.disabled = !snapshot.canRematch
      if (selectTrack) selectTrack.disabled = !snapshot.canRematch
      status.textContent = snapshot.error ??
        (snapshot.phase === 'preparing' || snapshot.phase === 'staging'
          ? 'Preparing the next race…'
          : snapshot.cup?.finished && snapshot.cup.index === snapshot.cup.total - 1 ? 'Cup complete! Final scores are ready.'
          : snapshot.canRematch ? 'Everyone finished. Ready for the next race.'
          : 'Waiting for the other racers to finish…')
    } else {
      status.textContent = snapshot.error ?? (snapshot.cup?.finished && snapshot.cup.index === snapshot.cup.total - 1
        ? 'Cup complete! Final scores are ready.' : 'Waiting for the host to choose the next race…')
    }
    list.replaceChildren(...standings.map(({ slot, car, identity, name, local, time, left }, index) => {
      const row = element('li', `scoreboard-row${local ? ' player' : ''}`)
      const label = nearbyRacerLabel({ slot, name, local })
      const topper = createTopperMarker(identity)
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
  frame.body.append(celebration, list, cupScores, status, nextTrack, createDiagnosticsControl(actions.downloadDiagnostics))
  if (race) frame.footer.append(race)
  if (selectTrack) frame.footer.append(selectTrack)
  frame.footer.append(button('LEAVE', 'nearby-leave-room', actions.leave, 'button button-danger'))
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
