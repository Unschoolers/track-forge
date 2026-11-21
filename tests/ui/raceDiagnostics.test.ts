// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResultsModal } from '@/ui/modals/resultsModal'
import type { RaceResult } from '@/application/race/raceSession'
import { asTrackId } from '@/domain/model'

const result: RaceResult = {
  mode: 'normal',
  trackId: asTrackId('diagnostics-race'),
  trackName: 'Figure eight',
  outcome: 'finished',
  playerPlace: 1, playerTime: 40.483, playerWrecked: false, newRecord: true,
  standings: [], highScores: [], ghostSaved: true,
}

function pointer(target: Element, type: string, x: number, id = 1): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: id },
    button: { value: 0 },
    clientX: { value: x },
    clientY: { value: 0 },
  })
  target.dispatchEvent(event)
}

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('hidden race diagnostics entry', () => {
  it('does not expose export on a tap, but opens after an 800ms hold and exports on request', () => {
    vi.useFakeTimers()
    const exportRace = vi.fn()
    const diagnosticsOpened = vi.fn()
    const modal = createResultsModal(result, {
      retry: vi.fn(), edit: vi.fn(), home: vi.fn(), exportRace, diagnosticsOpened,
    })
    document.body.append(modal)
    const target = modal.querySelector<HTMLElement>('[data-action="race-diagnostics"]')
    const panel = modal.querySelector<HTMLElement>('.race-diagnostics-panel')
    expect(target).not.toBeNull()
    expect(panel?.hidden).toBe(true)
    if (!target) throw new Error('Missing replay entry')

    pointer(target, 'pointerdown', 10)
    pointer(target, 'pointerup', 10)
    vi.advanceTimersByTime(1000)
    expect(panel?.hidden).toBe(true)
    pointer(target, 'pointerdown', 10)
    vi.advanceTimersByTime(799)
    expect(panel?.hidden).toBe(true)
    vi.advanceTimersByTime(1)
    expect(panel?.hidden).toBe(false)
    expect(diagnosticsOpened).toHaveBeenCalledTimes(1)
    modal.querySelector<HTMLButtonElement>('[data-action="export-race-diagnostics"]')?.click()
    expect(exportRace).toHaveBeenCalledTimes(1)
  })

  it('cancels scrolling, multitouch and cancelled holds without opening the advanced panel', () => {
    vi.useFakeTimers()
    const modal = createResultsModal(result, {
      retry: vi.fn(), edit: vi.fn(), home: vi.fn(), exportRace: vi.fn(),
    })
    document.body.append(modal)
    const target = modal.querySelector<HTMLElement>('[data-action="race-diagnostics"]')
    if (!target) throw new Error('Missing replay entry')
    pointer(target, 'pointerdown', 10)
    pointer(target, 'pointermove', 30)
    vi.advanceTimersByTime(1000)
    expect(modal.querySelector<HTMLElement>('.race-diagnostics-panel')?.hidden).toBe(true)
    pointer(target, 'pointerdown', 10)
    pointer(target, 'pointerdown', 10, 2)
    vi.advanceTimersByTime(1000)
    expect(modal.querySelector<HTMLElement>('.race-diagnostics-panel')?.hidden).toBe(true)
    pointer(target, 'pointerdown', 10)
    pointer(target, 'pointercancel', 10)
    vi.advanceTimersByTime(1000)
    expect(modal.querySelector<HTMLElement>('.race-diagnostics-panel')?.hidden).toBe(true)
  })

  it('keeps export available for non-record races and via keyboard', () => {
    const modal = createResultsModal({ ...result, ghostSaved: false, savedGhostTime: undefined }, {
      retry: vi.fn(), edit: vi.fn(), home: vi.fn(), exportRace: vi.fn(),
    })
    document.body.append(modal)
    const target = modal.querySelector<HTMLElement>('[data-action="race-diagnostics"]')
    expect(target?.textContent).toContain('RACE DATA READY')
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(modal.querySelector<HTMLElement>('.race-diagnostics-panel')?.hidden).toBe(false)
  })
})
