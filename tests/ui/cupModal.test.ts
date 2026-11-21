// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { AppSnapshot } from '@/application/appState'
import { createEditorState } from '@/domain/editor/editorState'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
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
      close: vi.fn(), addTrack: vi.fn(), removeTrack: vi.fn(), moveTrack: vi.fn(),
      start: vi.fn(), resume: vi.fn(), hostNearby: vi.fn(),
    }
    const overlay = createCupModal(state(['official-bridge', 'official-meadow']), actions)
    expect([...overlay.querySelectorAll('.cup-track-name')].map(node => node.textContent))
      .toEqual(['1. Bridge Run', '2. Meadow Loop'].map((name, index) => {
        const actual = OFFICIAL_CIRCUITS.find(({ track }) =>
          track.id === (index ? 'official-meadow' : 'official-bridge'))
        return `${index + 1}. ${actual?.track.name}`
      }))
    overlay.querySelector<HTMLButtonElement>('[data-action="cup-down-0"]')?.click()
    expect(actions.moveTrack).toHaveBeenCalledExactlyOnceWith(0, 1)
    overlay.querySelector<HTMLButtonElement>('[data-action="cup-remove-1"]')?.click()
    expect(actions.removeTrack).toHaveBeenCalledExactlyOnceWith(1)
    overlay.querySelector<HTMLButtonElement>('[data-action="cup-add-track"]')?.click()
    expect(actions.addTrack).toHaveBeenCalledOnce()
    overlay.querySelector<HTMLButtonElement>('[data-action="start-cup"]')?.click()
    expect(actions.start).toHaveBeenCalledOnce()
    overlay.querySelector<HTMLButtonElement>('[data-action="host-nearby-cup"]')?.click()
    expect(actions.hostNearby).toHaveBeenCalledOnce()
  })

  it('keeps cleared lineups editable but disallows starting an empty Cup', () => {
    const overlay = createCupModal(state([]), {
      close: vi.fn(), addTrack: vi.fn(), removeTrack: vi.fn(), moveTrack: vi.fn(),
      start: vi.fn(), resume: vi.fn(), hostNearby: vi.fn(),
    })
    expect(overlay.querySelector<HTMLButtonElement>('[data-action="start-cup"]')?.disabled).toBe(true)
    expect(overlay.querySelector<HTMLButtonElement>('[data-action="host-nearby-cup"]')?.disabled).toBe(true)
    expect(overlay.querySelector<HTMLButtonElement>('[data-action="cup-add-track"]')?.disabled).toBe(false)
  })
})
