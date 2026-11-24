// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { NearbyRace, type NearbyTransport } from '@/application/multiplayer/nearbyRace'
import { createNearbyRaceModal } from '@/ui/modals/nearbyRaceModal'
import type { NearbyConnectionModes } from '@/infrastructure/multiplayer/selectNearbyConnection'

function setup() {
  const adapter: NearbyTransport = {
    subscribe: () => () => {},
    host: vi.fn(async () => undefined),
    scan: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    connectDirect: vi.fn(async () => undefined),
    respond: vi.fn(async () => undefined),
    lock: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  }
  const race = new NearbyRace(adapter, () => true)
  const modes: NearbyConnectionModes = {
    choices: [{ mode: 'lan', label: 'LOCAL WI-FI', description: 'Same LAN' }],
    current: () => 'lan',
    choose: () => true,
    hostAddress: () => '192.168.1.8',
  }
  const actions = {
    close: vi.fn(), chooseTrack: vi.fn(), configureCup: vi.fn(), scan: vi.fn(),
    scanTracks: vi.fn(), saveTrack: vi.fn(), declineTrack: vi.fn(),
    downloadDiagnostics: vi.fn(async () => true), connectByIp: vi.fn(),
  }
  return { race, modes, actions }
}

describe('LAN room discovery fallback UI', () => {
  it('lets players enter a host IP when no broadcast rooms are found', () => {
    const { race, modes, actions } = setup()
    race.scan('blue')
    const modal = createNearbyRaceModal(race, actions, modes)
    expect(modal.textContent).toContain('CAN’T SEE THE HOST? JOIN BY IP')
    const input = modal.querySelector<HTMLInputElement>('input[aria-label="LAN host IPv4 address"]')
    expect(input?.getAttribute('placeholder')).toBe('192.168.1.20')
    if (!input) throw new Error('LAN address input missing')
    input.value = '192.168.1.9'
    modal.querySelector<HTMLButtonElement>('[data-action="nearby-connect-ip"]')?.click()
    expect(actions.connectByIp).toHaveBeenCalledWith('192.168.1.9')
    race.close()
  })
})
