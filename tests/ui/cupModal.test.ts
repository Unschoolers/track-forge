// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { AppSnapshot } from '@/application/appState'
import { createEditorState } from '@/domain/editor/editorState'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { createCup } from '@/application/race/circuitCup'
import { createCupModal } from '@/ui/modals/cupModal'

const track = OFFICIAL_CIRCUITS[0]?.track
if (!track) throw new Error('Missing official circuit for Cup UI test')

function state(lineup: readonly string[]): AppSnapshot {
  return {
    mode: 'home', paused: false, overlay: { type: 'cup' },
    tracks: [], currentTrack: track,
    editor: createEditorState(track.points, track.trees, track.start, track.terrain, track),
    editorUi: {
      tool: 'draw', surface: 'street', structure: 'surface',
      terrainBrush: { mode: 'ground', radius: 96 },
      grid: false, cameraRequest: null, selectedCrossing: null, selectedPoint: null,
    },
    preferences: {
      car: 'blue', difficulty: 'normal', audioEnabled: true,
      hapticsEnabled: true, dynamicZoomEnabled: true,
    },
    cupProgress: { checkpoint: null, bestPlacement: null, lineup },
    scoresByTrack: {}, notice: null,
  }
}

describe('Cup menu', () => {
  it('shows ordered tracks and dispatches deliberate edit/start actions', () => {
    const actions = {
      close: vi.fn(), addTrack: vi.fn(), loadCurated: vi.fn(), removeTrack: vi.fn(), moveTrack: vi.fn(),
      start: vi.fn(), resume: vi.fn(), hostNearby: vi.fn(),
    }
    const overlay = createCupModal(state([OFFICIAL_CIRCUITS[0]!.track.id, OFFICIAL_CIRCUITS[1]!.track.id]), actions)
    const lineup = overlay.querySelector('ol.cup-track-list')
    expect(lineup?.getAttribute('aria-label')).toBe('Cup track order')
    expect(lineup?.hasAttribute('aria-labelledby')).toBe(false)
    expect(lineup?.querySelectorAll('li')).toHaveLength(2)
    const first = OFFICIAL_CIRCUITS[0]
    const second = OFFICIAL_CIRCUITS[1]
    expect([...overlay.querySelectorAll('.cup-track-name')].map(node => node.textContent))
      .toEqual([`1. ${first?.track.name}`, `2. ${second?.track.name}`])
    overlay.querySelector<HTMLButtonElement>('[data-action="cup-down-0"]')?.click()
    expect(actions.moveTrack).toHaveBeenCalledExactlyOnceWith(0, 1)
    overlay.querySelector<HTMLButtonElement>('[data-action="cup-remove-1"]')?.click()
    expect(actions.removeTrack).toHaveBeenCalledExactlyOnceWith(1)
    overlay.querySelector<HTMLButtonElement>('[data-action="cup-add-track"]')?.click()
    expect(actions.addTrack).toHaveBeenCalledOnce()
    expect(overlay.querySelector('[data-action="cup-load-curated"]')?.textContent).toBe('LOAD CURATED CUP')
    overlay.querySelector<HTMLButtonElement>('[data-action="cup-load-curated"]')?.click()
    expect(actions.loadCurated).toHaveBeenCalledOnce()
    overlay.querySelector<HTMLButtonElement>('[data-action="start-cup"]')?.click()
    expect(actions.start).toHaveBeenCalledOnce()
    overlay.querySelector<HTMLButtonElement>('[data-action="host-nearby-cup"]')?.click()
    expect(actions.hostNearby).toHaveBeenCalledOnce()
  })

  it.each(['solo', 'nearby'] as const)('prioritizes the intended %s Cup action even with a saved solo checkpoint', (mode) => {
    const actions = {
      close: vi.fn(), addTrack: vi.fn(), loadCurated: vi.fn(), removeTrack: vi.fn(), moveTrack: vi.fn(),
      start: vi.fn(), resume: vi.fn(), hostNearby: vi.fn(),
    }
    const initial = state([track!.id])
    const overlay = createCupModal({
      ...initial,
      overlay: mode === 'nearby' ? { type: 'cup', returnTo: 'nearby' } : { type: 'cup' },
      cupProgress: { checkpoint: createCup(), bestPlacement: null, lineup: [track!.id] },
    }, actions)
    const primary = overlay.querySelectorAll<HTMLButtonElement>('.modal-footer .button-primary')
    expect(primary).toHaveLength(1)
    expect(primary[0]?.dataset.action).toBe(mode === 'nearby' ? 'host-nearby-cup' : 'start-cup')
    primary[0]?.click()
    expect(actions.hostNearby).toHaveBeenCalledTimes(mode === 'nearby' ? 1 : 0)
    expect(actions.start).toHaveBeenCalledTimes(mode === 'solo' ? 1 : 0)
    expect(actions.resume).not.toHaveBeenCalled()
    expect(overlay.querySelector('[data-action="resume-cup"]')).not.toBeNull()
  })

  it('keeps cleared lineups editable but disallows starting an empty Cup', () => {
    const overlay = createCupModal(state([]), {
      close: vi.fn(), addTrack: vi.fn(), loadCurated: vi.fn(), removeTrack: vi.fn(), moveTrack: vi.fn(),
      start: vi.fn(), resume: vi.fn(), hostNearby: vi.fn(),
    })
    expect(overlay.querySelector<HTMLButtonElement>('[data-action="start-cup"]')?.disabled).toBe(true)
    expect(overlay.querySelector<HTMLButtonElement>('[data-action="host-nearby-cup"]')?.disabled).toBe(true)
    expect(overlay.querySelector<HTMLButtonElement>('[data-action="cup-add-track"]')?.disabled).toBe(false)
  })
})
