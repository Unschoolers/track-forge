import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import { CAR_SPECS } from '@/domain/config'
import { populateRacePreparation } from '@/ui/components/racePreparationLayout'
import { button, element } from '@/ui/dom'
import type { ModalFrame } from '@/ui/modals/modalFrame'

type LobbySnapshot = ReturnType<NearbyRace['snapshot']>

export function populateNearbyLobby(frame: ModalFrame, nearby: NearbyRace, snapshot: LobbySnapshot, preview?: HTMLElement): void {
  const localSlot = nearby.localSlot()
  const laps = snapshot.laps ?? 1
  const metadata = [
    snapshot.lobbyTrack?.routeKind === 'point-to-point' ? 'Single run' : laps + (laps === 1 ? ' lap' : ' laps'),
    snapshot.lighting === 'night' ? 'Night race' : 'Day race',
    ...(snapshot.cup ? ['Cup ' + (snapshot.cup.index + 1) + '/' + snapshot.cup.total] : []),
  ]
  const rosterPanel = element('section', 'setup-section nearby-lobby-roster')
  const heading = element('div', 'nearby-lobby-roster-header')
  const accepted = snapshot.lobbyPlayers.filter(player => player.accepted).length
  const count = element('span', 'nearby-lobby-count', accepted + '/' + snapshot.lobbyPlayers.length + ' READY')
  count.setAttribute('role', 'status')
  heading.append(element('h3', 'setup-label', 'PLAYERS'), count)
  const roster = element('ol', 'nearby-lobby-players')
  for (const player of snapshot.lobbyPlayers) {
    const local = player.slot === localSlot
    const car = local ? snapshot.localCar : player.car
    const status = local && snapshot.unlockPending ? 'updating'
      : local && snapshot.readyPending ? 'confirming'
      : player.accepted ? 'ready' : car ? 'choosing' : 'loading'
    const row = element('li', 'nearby-lobby-player' + (local ? ' player' : ''))
    row.dataset.slot = String(player.slot)
    row.dataset.status = status
    const swatch = element('span', 'nearby-lobby-car-color')
    swatch.setAttribute('aria-hidden', 'true')
    if (car) swatch.style.setProperty('--lobby-car-color', CAR_SPECS[car].color)
    const copy = element('div', 'nearby-lobby-player-copy')
    const name = player.name ? player.name + (local ? ' (You)' : '') : local ? 'You' : 'Player ' + (player.slot + 1)
    const label = element('strong', 'nearby-lobby-player-name', name)
    label.title = name
    copy.append(label, element('span', 'nearby-lobby-player-meta',
      [player.slot === 0 ? 'Host' : null, car ? CAR_SPECS[car].name : 'No car yet'].filter(Boolean).join(' · ')))
    const state = element('span', 'nearby-lobby-player-status')
    const mark = element('span', 'nearby-lobby-status-icon', status === 'ready' ? '✓' : '·')
    mark.setAttribute('aria-hidden', 'true')
    const captions = { ready: 'READY', choosing: 'CHOOSING', loading: 'LOADING', confirming: 'CONFIRMING', updating: 'UPDATING' }
    state.append(mark, element('span', undefined, captions[status]))
    row.append(swatch, copy, state)
    roster.append(row)
  }
  rosterPanel.append(heading, roster)
  populateRacePreparation(frame.body, {
    car: snapshot.localCar,
    selectCar: car => nearby.selectLobbyCar(car),
    carLocked: snapshot.unlockPending || snapshot.localReady,
    preview,
    metadata: metadata.join(' · '),
    sections: [rosterPanel],
  })

  const message = snapshot.unlockPending ? 'Waiting for the host to unlock your car.'
    : snapshot.readyPending ? 'Confirming your readiness with the host…'
    : snapshot.localReady ? 'You’re ready. Waiting for the other players. Cancel Ready to change your car.'
    : 'Choose your car. The race starts when everyone is ready.'
  const feedback = element('p', 'nearby-lobby-feedback', message)
  feedback.setAttribute('role', 'status')
  feedback.dataset.ready = String(snapshot.localReady && !snapshot.readyPending && !snapshot.unlockPending)
  frame.footer.append(feedback)
  const ready = button(snapshot.unlockPending ? 'UPDATING…' : snapshot.localReady ? 'CANCEL READY' : 'I’M READY',
    'nearby-ready', () => nearby.setLobbyReady(!snapshot.localReady),
    snapshot.localReady || snapshot.unlockPending ? 'button nearby-ready-cancel' : 'button button-primary nearby-ready-action')
  ready.disabled = snapshot.unlockPending
  frame.footer.append(ready)
}
