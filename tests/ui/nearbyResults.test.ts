// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_IDENTITY } from '@/application/multiplayer/playerIdentity'
import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import type { RaceResult } from '@/application/race/raceSession'
import { createNearbyRaceResults } from '@/ui/modals/nearbyRaceModal'

type Racer = ReturnType<NearbyRace['standings']>[number]

function setup(outcome: RaceResult['outcome'] = 'finished') {
  const local: Racer = { slot: 0, car: 'blue', identity: DEFAULT_PLAYER_IDENTITY,
    name: undefined, local: true, time: outcome === 'finished' ? 42 : null, left: false }
  const rival: Racer = { slot: 1, car: 'red', identity: DEFAULT_PLAYER_IDENTITY,
    name: undefined, local: false, time: undefined, left: false }
  let changed: () => void = () => undefined
  const nearby = {
    snapshot: () => ({ role: 'host', track: 'Test Rally', phase: 'racing',
      canRematch: rival.time !== undefined }),
    standings: () => [local, rival].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || a.slot - b.slot),
    subscribe: (listener: () => void) => { changed = listener; return () => { changed = () => undefined } },
  } as unknown as NearbyRace
  const result: RaceResult = {
    outcome, mode: 'nearby', trackId: 'sample' as RaceResult['trackId'],
    trackName: 'Test Rally', playerPlace: 1, playerTime: local.time ?? null,
    playerWrecked: outcome === 'wrecked', newRecord: false, standings: [], highScores: [],
  }
  const modal = createNearbyRaceResults(nearby, result, {
    leave: () => undefined, race: () => undefined, selectTrack: () => undefined,
    downloadDiagnostics: async () => true,
  })
  return { view: modal.element, local, rival, update: () => changed(), cleanup: modal.cleanup }
}

describe('nearby race result celebration', () => {
  it('waits for the final placing before awarding the same champion celebration as solo', () => {
    const { view, rival, update, cleanup } = setup()
    expect(view.querySelector('.modal-title')?.textContent).toBe('NEARBY RACE RESULTS')
    expect(view.querySelector('[data-result-celebration]')).toBeNull()
    rival.time = 44
    update()
    expect(view.querySelector('.modal-title')?.textContent).toBe('VICTORY!')
    expect(view.querySelector('[data-result-celebration="victory"]')?.textContent).toContain('CHAMPION')
    expect(view.querySelector('.race-finish-medal')?.textContent).toContain('GOLD')
    cleanup()
  })

  it('awards second place instead of an incorrect victory when a rival finishes faster', () => {
    const { view, rival, update, cleanup } = setup()
    rival.time = 38
    update()
    expect(view.querySelector('.modal-title')?.textContent).toBe('FINISHED 2ND')
    expect(view.querySelector('[data-medal="SILVER"]')?.textContent).toContain('2ND PLACE')
    expect(view.querySelector('[data-result-celebration="victory"]')).toBeNull()
    expect(view.textContent).toContain('Behind winner · +00:04.000')
    cleanup()
  })

  it('does not award a medal when the local player fails to finish', () => {
    const { view, rival, update, cleanup } = setup('wrecked')
    rival.time = 40
    update()
    expect(view.querySelector('.modal-title')?.textContent).toBe('WRECKED')
    expect(view.querySelector('[data-medal]')).toBeNull()
    cleanup()
  })
})
