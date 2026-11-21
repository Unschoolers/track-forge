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
  playerWrecked: false, newRecord: false, highScores: [],
  standings: [
    { id: 'player', car: 'blue', player: true, place: 1, finishTime: 42, wrecked: false, lap: 1 },
    { id: 'ai-1', car: 'red', player: false, place: 2, finishTime: 43, wrecked: false, lap: 1 },
  ],
}
const actions = { retry: vi.fn(), edit: vi.fn(), home: vi.fn() }

describe('player names on finish screens', () => {
  it('shows the saved name with the player car and keeps live standings named', () => {
    const screen = createResultsModal(result, actions, undefined, null, 'JulienQC')
    expect(screen.textContent).toContain('DRIVER · JulienQC')
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

  it('shows the current player name on both Cup round and final standings', () => {
    const cup = recordCupResult(createCup(), result.standings)
    const round = createResultsModal(result, actions, { cup, next: vi.fn() }, null, 'JulienQC')
    expect(round.textContent).toContain('1. JulienQC · 10 points')
    const final = createCupFinalModal(cup, vi.fn(), 'JulienQC')
    expect(final.textContent).toContain('1. JulienQC · 10 points')
    expect(final.textContent).not.toContain('You · 10 points')
  })
})
