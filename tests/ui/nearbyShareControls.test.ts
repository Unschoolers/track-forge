// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { NearbyRace, type NearbyTransport } from '@/application/multiplayer/nearbyRace'
import type { RaceResult } from '@/application/race/raceSession'
import { asTrackId } from '@/domain/model'
import { createNearbyRaceModal, createNearbyRaceResults } from '@/ui/modals/nearbyRaceModal'
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
  playerWrecked: false, newRecord: false, standings: [], highScores: [], mode: 'nearby',
}

describe('Nearby sharing and rematch controls', () => {
  it('offers track receiving without hiding the existing race actions', () => {
    const nearby = new NearbyRace(transport, () => true)
    const scanTracks = vi.fn()
    const chooseTrack = vi.fn()
    const configureCup = vi.fn()
    try {
      const modal = createNearbyRaceModal(nearby, 'blue', {
        close: vi.fn(), chooseTrack, configureCup, scan: vi.fn(), scanTracks,
        saveTrack: vi.fn(), declineTrack: vi.fn(), selectCar: vi.fn(),
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
