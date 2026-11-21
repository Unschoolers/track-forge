// @vitest-environment jsdom

import { expect, it, vi } from 'vitest'
import { NearbyRace, type NearbyTransport } from '@/application/multiplayer/nearbyRace'
import { createNearbyRaceModal } from '@/ui/modals/nearbyRaceModal'

it('offers a diagnostic download after Nearby hosting fails and allows retrying a failed save', async () => {
  const transport: NearbyTransport = {
    subscribe: () => () => undefined,
    host: async () => { throw new Error('Could not host a nearby room.') },
    scan: vi.fn(),
    connect: vi.fn(),
    respond: vi.fn(),
    lock: vi.fn(),
    send: vi.fn(),
    stop: vi.fn(),
  }
  const nearby = new NearbyRace(transport, () => true)
  const track = { name: 'Diagnostic circuit' } as Parameters<NearbyRace['host']>[0]['track']
  nearby.host({ track, laps: 1, lighting: 'day', car: 'blue' })
  await vi.waitFor(() => expect(nearby.snapshot().error).toBe('Could not host a nearby room.'))

  const download = vi.fn<() => Promise<boolean>>()
    .mockRejectedValueOnce(new Error('Storage unavailable'))
    .mockResolvedValueOnce(true)
  const view = createNearbyRaceModal(nearby, 'blue', {
    close: vi.fn(), chooseTrack: vi.fn(), configureCup: vi.fn(), scan: vi.fn(), scanTracks: vi.fn(), saveTrack: vi.fn(), declineTrack: vi.fn(),
    selectCar: vi.fn(), downloadDiagnostics: download,
  })
  const button = view.querySelector<HTMLButtonElement>('[data-action="nearby-download-diagnostics"]')
  expect(button?.textContent).toBe('DOWNLOAD DIAGNOSTICS')
  button?.click()
  expect(button?.disabled).toBe(true)
  await vi.waitFor(() => expect(view.textContent).toContain('Could not save the diagnostic report'))
  expect(button?.disabled).toBe(false)
  button?.click()
  await vi.waitFor(() => expect(view.textContent).toContain('Diagnostic report saved.'))
  expect(download).toHaveBeenCalledTimes(2)
  nearby.destroy()
})

it('shows the remembered topper but keeps the picker closed until explicitly requested', () => {
  const transport: NearbyTransport = {
    subscribe: () => () => undefined,
    host: vi.fn(), scan: vi.fn(), connect: vi.fn(), respond: vi.fn(),
    lock: vi.fn(), send: vi.fn(), stop: vi.fn(),
  }
  const nearby = new NearbyRace(transport, () => true)
  const toggleCustomize = vi.fn()
  const selectIdentity = vi.fn()
  const actions = {
    close: vi.fn(), chooseTrack: vi.fn(), configureCup: vi.fn(), scan: vi.fn(), scanTracks: vi.fn(), saveTrack: vi.fn(), declineTrack: vi.fn(), selectCar: vi.fn(),
    downloadDiagnostics: vi.fn(async () => true), toggleCustomize, selectIdentity,
  }
  const identity = { icon: 'crown', color: 'gold' } as const
  const collapsed = createNearbyRaceModal(nearby, 'blue', actions, identity, false)
  expect(collapsed.textContent).toContain('Your topper')
  expect(collapsed.textContent).toContain('crown / gold')
  expect(collapsed.querySelector('[data-action="nearby-topper-icon-star"]')).toBeNull()
  collapsed.querySelector<HTMLButtonElement>('[data-action="nearby-customize-topper"]')?.click()
  expect(toggleCustomize).toHaveBeenCalledOnce()

  const expanded = createNearbyRaceModal(nearby, 'blue', actions, identity, true)
  expect(expanded.querySelectorAll('[data-action^="nearby-topper-icon-"]')).toHaveLength(6)
  expect(expanded.querySelectorAll('[data-action^="nearby-topper-color-"]')).toHaveLength(6)
  expect(expanded.querySelector('[data-action="nearby-topper-icon-crown"]')?.getAttribute('aria-pressed')).toBe('true')
  expanded.querySelector<HTMLButtonElement>('[data-action="nearby-topper-icon-flag"]')?.click()
  expanded.querySelector<HTMLButtonElement>('[data-action="nearby-topper-color-pink"]')?.click()
  expect(selectIdentity).toHaveBeenNthCalledWith(1, { icon: 'flag', color: 'gold' })
  expect(selectIdentity).toHaveBeenNthCalledWith(2, { icon: 'crown', color: 'pink' })
  nearby.destroy()
})

