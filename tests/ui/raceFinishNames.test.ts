// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { RaceResult } from '@/application/race/raceSession'
import { createCup, recordCupResult } from '@/application/race/circuitCup'
import { asTrackId } from '@/domain/model'
import { createResultsModal, createCupFinalModal } from '@/ui/modals/resultsModal'
import { createStandings, updateStandings } from '@/ui/components/scoreboard'

const result: RaceResult = {
  mode: 'normal', outcome: 'finished', trackId: asTrackId('results-test'),
  trackName: 'Figure eight', playerPlace: 1, playerTime: 42,
  newRecord: false, highScores: [],
  standings: [
    { id: 'player', car: 'blue', player: true, place: 1, finishTime: 42, lap: 1 },
    { id: 'ai-1', car: 'red', player: false, place: 2, finishTime: 43, lap: 1 },
  ],
}
const actions = { retry: vi.fn(), edit: vi.fn(), home: vi.fn() }

describe('player names on finish screens', () => {
  it('shows the saved name with the player car and keeps live standings named', () => {
    const screen = createResultsModal(result, actions, undefined, null, 'JulienQC')
    expect(screen.textContent).not.toContain('DRIVER · JulienQC')
    const list = screen.querySelector<HTMLElement>('[data-results-standings]')
    expect(list?.querySelector('.scoreboard-row.player strong')?.textContent).toMatch(/^1\. JulienQC · /)
    expect(list?.querySelectorAll('.scoreboard-row')).toHaveLength(2)
    if (!list) throw new Error('Missing standings list')
    updateStandings(list, result.standings, true, 'JulienQC')
    expect(list.querySelector('.scoreboard-row.player strong')?.textContent).toContain('JulienQC')
    expect(createStandings(result.standings).textContent).toContain('You · ')
  })

  it('shows the name even when a time trial has no standings list', () => {
    const screen = createResultsModal({ ...result, mode: 'time-trial' }, actions, undefined, null, 'JulienQC')
    expect(screen.textContent).toContain('DRIVER · JulienQC')
    expect(screen.querySelector('[data-results-standings]')).toBeNull()
  })

  it('provides a compact duplicated finish time for standings results with a completed time', () => {
    const screen = createResultsModal(result, actions)
    const summary = screen.querySelector('.modal-header .results-finish-time')
    expect(summary?.getAttribute('aria-hidden')).toBe('true')
    expect(summary?.querySelector('strong')?.textContent).toBe('00:42.000')
    expect(screen.querySelector('.modal-header .modal-subtitle')?.textContent).toBe('Figure eight')
    expect(screen.querySelector('[data-results-standings] .player span')?.textContent).toBe('00:42.000')
    const unfinished = createResultsModal({ ...result, playerTime: null }, actions)
    expect(unfinished.querySelector('.modal-header .results-finish-time')).toBeNull()
  })

  it.each([
    { mode: 'time-trial' },
    { mode: 'boost-practice' },
    { mode: 'normal', ghostTime: 45 },
  ] as const)('gives the finish time its own primary readout without standings in $mode', (setup) => {
    const screen = createResultsModal({ ...result, ...setup }, actions)
    expect(screen.querySelector('.modal-header .modal-subtitle')?.textContent).toBe('Figure eight')
    expect(screen.querySelector('.results-finish-time strong')?.textContent).toBe('00:42.000')
  })

  it('shows the current player name on both Cup round and final standings', () => {
    const cup = recordCupResult(createCup(), result.standings)
    const round = createResultsModal(result, actions, { cup, next: vi.fn() }, null, 'JulienQC')
    expect(round.textContent).toContain('1. JulienQC · 10 points')
    const final = createCupFinalModal(cup, vi.fn(), 'JulienQC')
    expect(final.textContent).toContain('1. JulienQC · 10 points')
    expect(final.textContent).not.toContain('You · 10 points')
  })
  it('celebrates a win once while preserving scores and all navigation without hiding actions in the scroll body', () => {
    const winning = {
      ...result,
      newRecord: true,
      playerTime: 40.016,
      standings: [
        { ...result.standings[0]!, finishTime: 40.016 },
        { ...result.standings[1]!, finishTime: 41.783 },
      ],
      highScores: [{ time: 40.016, car: 'blue' as const, difficulty: 'hard' as const, recordedAt: 10 }],
    }
    const screen = createResultsModal(winning, actions, undefined, null, 'JulienQC')
    const body = screen.querySelector('.modal-body')
    const footer = screen.querySelector('.modal-footer')
    const victory = screen.querySelector('.results-celebration')
    expect(screen.querySelector('.modal-title')?.textContent).toBe('VICTORY!')
    expect(screen.querySelector('.modal-header .modal-subtitle')?.textContent).toBe('Figure eight')
    expect(victory?.textContent).toContain('1ST PLACE')
    expect(victory?.textContent).toContain('GOLD MEDAL')
    expect(victory?.textContent).toContain('NEW RECORD')
    expect(screen.querySelector('.race-finish-medal')).toBeNull()
    expect(screen.querySelector('.results-history')).toBeNull()
    expect(body?.querySelector('[data-action="results-home"]')).toBeNull()
    expect(footer?.querySelector('[data-action="results-home"]')).not.toBeNull()
    expect(footer?.querySelector('[data-action="edit-race-track"]')).not.toBeNull()
    expect(footer?.querySelector('[data-action="retry-race"]')).not.toBeNull()
    expect(footer?.querySelector('[data-action="change-track"]')).not.toBeNull()
  })

  it('keeps additional historical times available in a collapsed disclosure', () => {
    const screen = createResultsModal({
      ...result,
      playerTime: 40,
      highScores: [
        { time: 40, car: 'blue', difficulty: 'hard', recordedAt: 10 },
        { time: 42, car: 'red', difficulty: 'normal', recordedAt: 9 },
      ],
    }, actions)
    const history = screen.querySelector<HTMLDetailsElement>('.results-history')
    expect(history).not.toBeNull()
    expect(history?.open).toBe(false)
    expect(history?.querySelectorAll('.scoreboard-row')).toHaveLength(2)
    history?.querySelector<HTMLElement>('summary')?.click()
    expect(history?.open).toBe(true)
  })

  it('keeps advanced splits out of the summary and opens a single full-screen details dialog', () => {
    const splits = [
      { lap: 0, gate: 1 as const, time: 8 },
      { lap: 0, gate: 2 as const, time: 17 },
      { lap: 0, gate: 3 as const, time: 26 },
      { lap: 0, gate: 4 as const, time: 42 },
    ]
    const screen = createResultsModal({ ...result, splits }, actions)
    document.body.append(screen)
    expect(screen.querySelector('.results-splits-detail-row')).toBeNull()
    const open = screen.querySelector<HTMLButtonElement>('[data-action="open-race-splits"]')
    expect(open?.textContent).toContain('VIEW SPLITS · 4')
    open?.click()
    expect(screen.classList.contains('results-splits-open')).toBe(true)
    expect(screen.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(screen.querySelectorAll('.results-splits-detail-row')).toHaveLength(4)
    expect(screen.textContent).toContain('LAP 1 · FINISH')
    expect(screen.querySelectorAll('.results-splits-detail-row')[1]?.textContent).toContain('00:09.000')
    screen.querySelector<HTMLButtonElement>('[data-action="close-race-splits"]')?.click()
    expect(screen.classList.contains('results-splits-open')).toBe(false)
    expect(screen.querySelector('.results-splits-detail-row')).toBeNull()
    expect(screen.querySelector('[data-action="retry-race"]')).not.toBeNull()
    screen.remove()
  })

  it('auto-scrolls only overflowing splits; tapping pauses and resumes while Escape returns to results', () => {
    vi.useFakeTimers()
    try {
      const splits = Array.from({ length: 12 }, (_, index) => ({
        lap: Math.floor(index / 4),
        gate: ((index % 4) + 1) as 1 | 2 | 3 | 4,
        time: 10 * (index + 1),
      }))
      const screen = createResultsModal({ ...result, splits }, actions)
      document.body.append(screen)
      screen.querySelector<HTMLButtonElement>('[data-action="open-race-splits"]')?.click()
      const list = screen.querySelector<HTMLElement>('.results-splits-list')
      if (!list) throw new Error('Missing splits details list')
      Object.defineProperties(list, {
        scrollHeight: { configurable: true, value: 800 },
        clientHeight: { configurable: true, value: 200 },
      })
      screen.querySelector<HTMLButtonElement>('[data-action="close-race-splits"]')?.click()
      screen.querySelector<HTMLButtonElement>('[data-action="open-race-splits"]')?.click()
      expect(list.getAttribute('aria-pressed')).toBe('false')
      vi.advanceTimersByTime(2700)
      expect(list.scrollTop).toBeGreaterThan(0)
      list.click()
      expect(list.getAttribute('aria-pressed')).toBe('true')
      const frozen = list.scrollTop
      vi.advanceTimersByTime(8100)
      expect(list.scrollTop).toBe(frozen)
      list.click()
      vi.advanceTimersByTime(2700)
      expect(list.scrollTop).toBeGreaterThan(frozen)
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(screen.querySelector('.results-splits-list')).toBeNull()
      expect(screen.querySelector('[data-action="open-race-splits"]')).not.toBeNull()
      const positionAtClose = list.scrollTop
      screen.remove()
      vi.advanceTimersByTime(8100)
      expect(list.scrollTop).toBe(positionAtClose)
    } finally {
      vi.useRealTimers()
    }
  })

})
