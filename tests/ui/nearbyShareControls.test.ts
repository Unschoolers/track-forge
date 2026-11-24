// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { NearbyRace, type NearbyTransport } from '@/application/multiplayer/nearbyRace'
import type { RaceResult } from '@/application/race/raceSession'
import { asTrackId } from '@/domain/model'
import { createNearbyLeaveConfirmation, createNearbyRaceModal, createNearbyRaceResults } from '@/ui/modals/nearbyRaceModal'
import { nearbyTrack } from '../fixtures/nearbyRace'

const transport: NearbyTransport = {
  subscribe: () => () => undefined,
  host: async () => undefined,
  scan: async () => undefined,
  connect: async () => undefined,
  respond: async () => undefined,
  lock: async () => undefined,
  send: async () => undefined,
  stop: async () => undefined,
}

const result: RaceResult = {
  outcome: 'finished', trackId: asTrackId('nearby-results'),
  trackName: 'Figure eight', playerPlace: 1, playerTime: 41.5,
  newRecord: false, standings: [], highScores: [], mode: 'nearby',
}

describe('Nearby sharing and rematch controls', () => {
  it.each(['host', 'guest'] as const)('makes staying the safe default for a %s leaving the lobby', role => {
    const actions = { stay: vi.fn(), leave: vi.fn() }
    const confirmation = createNearbyLeaveConfirmation(role, actions)
    expect(confirmation.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Leave room?')
    expect(confirmation.textContent).toContain(role === 'host' ? 'close the room for everyone' : 'disconnect from the room')
    const stay = confirmation.querySelector<HTMLButtonElement>('[data-action="nearby-stay"]')
    const leave = confirmation.querySelector<HTMLButtonElement>('[data-action="nearby-confirm-leave"]')
    expect(stay?.classList.contains('button-primary')).toBe(true)
    expect(leave?.classList.contains('button-danger')).toBe(true)
    stay?.click()
    confirmation.querySelector<HTMLButtonElement>('[data-action="close-dialog"]')?.click()
    expect(actions.stay).toHaveBeenCalledTimes(2)
    expect(actions.leave).not.toHaveBeenCalled()
    leave?.click()
    expect(actions.leave).toHaveBeenCalledOnce()
  })

  it('shows car specifications and explicit consent in the race lobby', () => {
    const selectLobbyCar = vi.fn()
    const setLobbyReady = vi.fn()
    const nearby = {
      snapshot: () => ({ phase: 'lobby', role: 'host', purpose: 'race', track: 'Figure eight', laps: 2,
        localCar: 'red', localReady: false, unlockPending: false, error: null,
        lobbyPlayers: [{ slot: 0, car: 'red', name: 'Host', accepted: false, choice: 0 },
          { slot: 1, car: 'green', name: 'Guest', accepted: true, choice: 1 }] }),
      localSlot: () => 0, selectLobbyCar, setLobbyReady,
    } as unknown as NearbyRace
    const modal = createNearbyRaceModal(nearby, 'blue', {
      close: vi.fn(), chooseTrack: vi.fn(), configureCup: vi.fn(), scan: vi.fn(), scanTracks: vi.fn(),
      saveTrack: vi.fn(), declineTrack: vi.fn(), connectByIp: vi.fn(), selectCar: vi.fn(),
      downloadDiagnostics: vi.fn(async () => true),
    })
    expect(modal.textContent).toContain('1/2 READY')
    expect(modal.querySelector('.car-summary-title')?.textContent).toContain('Red')
    expect(modal.querySelectorAll('.car-stat')).toHaveLength(4)
    modal.querySelector<HTMLButtonElement>('[data-action="car-green"]')?.click()
    expect(selectLobbyCar).toHaveBeenCalledWith('green')
    modal.querySelector<HTMLButtonElement>('[data-action="nearby-ready"]')?.click()
    expect(setLobbyReady).toHaveBeenCalledWith(true)
  })

  it.each([
    { role: 'host', localReady: true, readyPending: false, unlockPending: false, status: 'ready', label: 'CANCEL READY', disabled: false },
    { role: 'guest', localReady: true, readyPending: true, unlockPending: false, status: 'confirming', label: 'CANCEL READY', disabled: false },
    { role: 'guest', localReady: false, readyPending: false, unlockPending: true, status: 'updating', label: 'UPDATING…', disabled: true },
  ] as const)('distinguishes $status and keeps locked cars immutable', state => {
    const localSlot = state.role === 'host' ? 0 : 1
    const setLobbyReady = vi.fn()
    const selectLobbyCar = vi.fn()
    const nearby = {
      snapshot: () => ({
        phase: 'lobby', purpose: 'race', track: 'Figure eight', lighting: 'night', laps: 2,
        localCar: 'red', ...state,
        lobbyPlayers: Array.from({ length: 8 }, (_, slot) => ({
          slot, car: slot === 7 ? null : slot === localSlot ? 'red' : 'green',
          name: 'Racer ' + slot, accepted: slot !== 7 && (slot !== localSlot || state.status === 'ready'), choice: 1,
        })),
      }),
      localSlot: () => localSlot, selectLobbyCar, setLobbyReady,
    } as unknown as NearbyRace
    const modal = createNearbyRaceModal(nearby, 'blue', {
      close: vi.fn(), chooseTrack: vi.fn(), configureCup: vi.fn(), scan: vi.fn(), scanTracks: vi.fn(),
      saveTrack: vi.fn(), declineTrack: vi.fn(), connectByIp: vi.fn(), selectCar: vi.fn(),
      downloadDiagnostics: vi.fn(async () => true),
    })
    expect(modal.classList.contains('nearby-lobby-modal')).toBe(true)
    expect(modal.querySelector('.nearby-lobby-course')?.textContent).toContain('2 laps · Night race')
    expect(modal.querySelectorAll('.nearby-lobby-player')).toHaveLength(8)
    expect(modal.querySelector('.nearby-lobby-player.player')?.getAttribute('data-status')).toBe(state.status)
    expect(modal.querySelector('[data-slot="7"]')?.getAttribute('data-status')).toBe('loading')
    expect(modal.querySelectorAll('.nearby-lobby-picker .car-choice:disabled')).toHaveLength(4)
    expect(modal.querySelector('.nearby-lobby-feedback')?.getAttribute('data-ready')).toBe(String(state.status === 'ready'))
    const ready = modal.querySelector<HTMLButtonElement>('[data-action="nearby-ready"]')
    expect(ready?.textContent).toBe(state.label)
    expect(ready?.disabled).toBe(state.disabled)
    modal.querySelector<HTMLButtonElement>('[data-action="car-green"]')?.click()
    expect(selectLobbyCar).not.toHaveBeenCalled()
    ready?.click()
    if (state.disabled) expect(setLobbyReady).not.toHaveBeenCalled()
    else expect(setLobbyReady).toHaveBeenCalledWith(false)
  })

  it('shows host-selectable Day/Night choices for normal races and Cups', async () => {
    const nearby = new NearbyRace(transport, () => true)
    const actions = {
      close: vi.fn(), chooseTrack: vi.fn(), configureCup: vi.fn(), scan: vi.fn(), scanTracks: vi.fn(),
      saveTrack: vi.fn(), declineTrack: vi.fn(), connectByIp: vi.fn(), selectCar: vi.fn(),
      downloadDiagnostics: vi.fn(async () => true),
    }
    try {
      nearby.host({ track: nearbyTrack, car: 'blue', laps: 2, lighting: 'day' })
      await vi.waitFor(() => expect(nearby.snapshot().phase).toBe('hosting'))
      const modal = createNearbyRaceModal(nearby, 'blue', actions)
      const day = modal.querySelector<HTMLButtonElement>('[data-action="nearby-lighting-day"]')
      const night = modal.querySelector<HTMLButtonElement>('[data-action="nearby-lighting-night"]')
      expect(day?.getAttribute('aria-pressed')).toBe('true')
      expect(night?.getAttribute('aria-pressed')).toBe('false')
      night?.click()
      expect(nearby.snapshot().lighting).toBe('night')
      nearby.close()
      nearby.hostCup([nearbyTrack, nearbyTrack], 'blue', 2)
      await vi.waitFor(() => expect(nearby.snapshot().phase).toBe('hosting'))
      const cup = createNearbyRaceModal(nearby, 'blue', actions)
      expect(cup.textContent).toContain('CUP LIGHTING')
      cup.querySelector<HTMLButtonElement>('[data-action="nearby-lighting-night"]')?.click()
      expect(nearby.snapshot().lighting).toBe('night')
    } finally {
      nearby.destroy()
    }
  })

  it('offers track receiving without hiding the existing race actions', () => {
    const nearby = new NearbyRace(transport, () => true)
    const scanTracks = vi.fn()
    const chooseTrack = vi.fn()
    const configureCup = vi.fn()
    try {
      const modal = createNearbyRaceModal(nearby, 'blue', {
        close: vi.fn(), chooseTrack, configureCup, scan: vi.fn(), scanTracks,
        saveTrack: vi.fn(), declineTrack: vi.fn(), connectByIp: vi.fn(), selectCar: vi.fn(),
        downloadDiagnostics: vi.fn(async () => true),
      })
      const host = modal.querySelector<HTMLButtonElement>('[data-action="nearby-choose-track"]')
      expect(host?.textContent).toBe('CHOOSE TRACK TO HOST')
      expect(host?.classList.contains('button-primary')).toBe(true)
      host?.click()
      expect(chooseTrack).toHaveBeenCalledOnce()
      modal.querySelector<HTMLButtonElement>('[data-action="nearby-host-cup"]')?.click()
      expect(configureCup).toHaveBeenCalledOnce()
      expect(modal.querySelector('[data-action="nearby-scan"]')).not.toBeNull()
      modal.querySelector<HTMLButtonElement>('[data-action="nearby-receive-track"]')?.click()
      expect(scanTracks).toHaveBeenCalledOnce()
    } finally {
      nearby.destroy()
    }
  })

  it('renders each peer name with its car and falls back only for unnamed racers', () => {
    const nearby = {
      snapshot: () => ({ role: 'guest', canRematch: false, error: null }),
      standings: () => [
        { slot: 0, car: 'blue', identity: { icon: 'star', color: 'cyan' }, name: 'JulienQC', local: false, time: 40, left: false },
        { slot: 1, car: 'red', identity: { icon: 'crown', color: 'gold' }, name: 'Émile', local: true, time: 41, left: false },
        { slot: 2, car: 'green', identity: { icon: 'bolt', color: 'pink' }, local: false, time: null, left: true },
      ],
      subscribe: () => () => undefined,
    } as unknown as NearbyRace
    const view = createNearbyRaceResults(nearby, result, {
      race: vi.fn(), selectTrack: vi.fn(), leave: vi.fn(),
      downloadDiagnostics: vi.fn(async () => true),
    })
    const rows = [...view.element.querySelectorAll('.scoreboard-row')].map(node => node.textContent)
    expect(rows[0]).toContain('JulienQC · ')
    expect(rows[1]).toContain('Émile (You) · ')
    expect(rows[2]).toContain('Player 3 · ')
    expect(rows[2]).toContain('LEFT')
    const rivalMarker = view.element.querySelectorAll<HTMLElement>('.scoreboard-row .topper-marker')[2]
    expect(rivalMarker?.style.color).toBe('rgb(255, 103, 159)')
    expect(rivalMarker?.querySelector('svg[fill="currentColor"] path')).not.toBeNull()
    view.cleanup()
  })

  it('gives the host race/select track/leave, but guests only leave', async () => {
    const host = new NearbyRace(transport, () => true)
    const guest = new NearbyRace(transport, () => true)
    try {
      host.host({ track: nearbyTrack, car: 'blue', laps: 2, lighting: 'day' })
      await vi.waitFor(() => expect(host.snapshot().phase).toBe('hosting'))
      guest.scan('red')
      const leaveHost = vi.fn()
      const hostActions = {
        race: vi.fn(), selectTrack: vi.fn(), leave: leaveHost,
        downloadDiagnostics: vi.fn(async () => true),
      }
      const hostResults = createNearbyRaceResults(host, result, hostActions)
      const raceButton = hostResults.element.querySelector<HTMLButtonElement>('[data-action="nearby-race-again"]')
      expect(raceButton?.textContent).toBe('RACE AGAIN')
      expect(raceButton?.disabled).toBe(true)
      expect(hostResults.element.querySelector('[data-action="nearby-next-track"]')).not.toBeNull()
      hostResults.element.querySelector<HTMLButtonElement>('[data-action="nearby-leave-room"]')?.click()
      expect(leaveHost).toHaveBeenCalledOnce()

      const guestResults = createNearbyRaceResults(guest, result, {
        race: vi.fn(), selectTrack: vi.fn(), leave: vi.fn(),
        downloadDiagnostics: vi.fn(async () => true),
      })
      expect(guestResults.element.querySelector('[data-action="nearby-race-again"]')).toBeNull()
      expect(guestResults.element.querySelector('[data-action="nearby-next-track"]')).toBeNull()
      expect(guestResults.element.querySelector('[data-action="nearby-leave-room"]')).not.toBeNull()
      hostResults.cleanup()
      guestResults.cleanup()
    } finally {
      host.destroy()
      guest.destroy()
    }
  })
})
