// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import type { AppSnapshot } from '@/application/appState'
import { createHomeScreen } from '@/ui/screens/homeScreen'

const track = createStarterTrack(asTrackId('starter'), 1)
const state: AppSnapshot = {
  mode: 'home', paused: false, overlay: { type: 'none' }, tracks: [track], currentTrack: track,
  editor: createEditorState(track.points, track.trees),
  preferences: { car: 'blue', difficulty: 'normal', audioEnabled: true, hapticsEnabled: true, dynamicZoomEnabled: true },
  editorUi: { tool: 'draw', surface: 'street', structure: 'overpass', terrainBrush: { mode: 'raise', radius: 48 }, grid: false,
    cameraRequest: null, selectedCrossing: null, selectedPoint: null },
  scoresByTrack: {}, notice: null, raceAgainTrackName: 'City Sprint',
}

describe('home screen', () => {
  it('keeps racing primary and exposes the available navigation and update actions', () => {
    const race = vi.fn()
    const raceAgain = vi.fn()
    const edit = vi.fn()
    const nearby = vi.fn()
    const cup = vi.fn()
    const options = vi.fn()
    const updates = vi.fn()
    const screen = createHomeScreen(state, { race, raceAgain, edit, nearby, cup, options, updates })

    expect(screen.classList.contains('tf-menu')).toBe(true)
    expect(screen.querySelector('[aria-label="Race"] [data-action="race"]')?.classList.contains('tf-menu-action--primary')).toBe(true)
    const raceAgainAction = screen.querySelector('[aria-label="Race"] [data-action="race-again"]')
    expect(raceAgainAction?.getAttribute('aria-label')).toBe('Race again · City Sprint')
    expect(raceAgainAction?.querySelector('.home-race-again-label')?.textContent).toBe('Race again')
    expect(raceAgainAction?.querySelector('.home-race-again-track')?.textContent).toBe('City Sprint')
    const navigation = screen.querySelector('nav[aria-label="Main menu"]')
    expect(navigation?.querySelectorAll(':scope > button')).toHaveLength(5)
    expect(navigation?.closest('[data-material]')).toBeNull()
    expect(screen.querySelectorAll('.tf-menu-dock')).toHaveLength(1)
    expect(screen.textContent).toContain(track.name)

    for (const [action, callback] of Object.entries({ race, 'race-again': raceAgain, editor: edit, nearby, 'arcade-cup': cup, options, 'open-updates': updates })) {
      screen.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click()
      expect(callback).toHaveBeenCalledOnce()
    }
  })

  it('omits optional routes when their actions are unavailable', () => {
    const screen = createHomeScreen({ ...state, raceAgainTrackName: undefined }, { race: vi.fn(), raceAgain: vi.fn(), edit: vi.fn(), options: vi.fn() })
    expect(screen.querySelector('[data-action="race-again"]')).toBeNull()
    expect(screen.querySelector('[data-action="nearby"]')).toBeNull()
    expect(screen.querySelector('[data-action="arcade-cup"]')).toBeNull()
    expect(screen.querySelector('[data-action="open-updates"]')).toBeNull()
  })
})
