import { describe, expect, it, vi } from 'vitest'
import { createRaceSetupModal } from '@/ui/modals/raceSetupModal'
import { createResultsModal } from '@/ui/modals/resultsModal'
import { createEditorState } from '@/domain/editor/editorState'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'
import type { AppSnapshot } from '@/application/appState'
import type { RaceResult } from '@/application/race/raceSession'

const track = createStarterTrack(asTrackId('ghost-ui'), 1)
const state: AppSnapshot = {
  mode: 'home', paused: false, overlay: { type: 'race-setup' },
  tracks: [track], currentTrack: track, editor: createEditorState(track.points, track.trees),
  editorUi: { tool: 'draw', surface: 'street', structure: 'overpass',
    terrainBrush: { mode: 'raise', radius: 48 }, grid: false, cameraRequest: null,
    selectedCrossing: null, selectedPoint: null },
  preferences: { car: 'blue', difficulty: 'normal', lighting: 'day',
    audioEnabled: true, hapticsEnabled: true, dynamicZoomEnabled: true, handling: 'arcade' },
  scoresByTrack: {}, notice: null,
}
const actions = () => ({ close: vi.fn(), preferences: vi.fn(), start: vi.fn() })
describe('Ghost Race setup', () => {
  it('always shows a disabled Ghost Race button when no replay is available', () => {
    const modal = createRaceSetupModal(state, actions(), null)
    const ghost = modal.querySelector<HTMLButtonElement>('[data-action="mode-ghost"]')
    expect(ghost).not.toBeNull()
    expect(ghost?.hidden).toBe(false)
    expect(ghost?.disabled).toBe(true)
    expect(modal.textContent).toContain('Finish a race with this setup to save a ghost.')
    expect(modal.querySelector('[data-action="mode-normal"]')?.getAttribute('aria-pressed')).toBe('true')
  })
  it('offers the saved target and dispatches the selected race mode', () => {
    const callbacks = actions()
    const modal = createRaceSetupModal(state, callbacks, 62.345)
    const ghost = modal.querySelector<HTMLButtonElement>('[data-action="mode-ghost"]')
    expect(ghost?.disabled).toBe(false)
    expect(modal.textContent).toContain('01:02.345')
    ghost?.click()
    expect(callbacks.preferences).toHaveBeenCalledWith({ ...state.preferences, raceMode: 'ghost' })
    const selected = createRaceSetupModal({ ...state, preferences: {
      ...state.preferences, raceMode: 'ghost',
    } }, callbacks, 62.345)
    expect(selected.querySelector('[data-action="mode-ghost"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(selected.querySelector('[data-action="setup-start"]')?.textContent).toBe('START GHOST RACE')
    const stale = createRaceSetupModal({ ...state, preferences: {
      ...state.preferences, raceMode: 'ghost',
    } }, callbacks, null)
    expect(stale.querySelector('[data-action="mode-normal"]')?.getAttribute('aria-pressed')).toBe('true')
  })
  it('compares the finish with the original ghost instead of awarding a solo-race medal', () => {
    const result: RaceResult = { outcome: 'finished', trackId: track.id, trackName: track.name,
      playerPlace: 1, playerTime: 61, playerWrecked: false, newRecord: false,
      standings: [], highScores: [], ghostTime: 62.345, ghostSaved: true, savedGhostTime: 61 }
    const modal = createResultsModal(result, { retry() {}, edit() {}, home() {} })
    expect(modal.textContent).toContain('GHOST BEATEN')
    expect(modal.textContent).toContain('BEST GHOST SAVED')
    expect(modal.querySelector('.race-finish-medal')).toBeNull()
    expect(createResultsModal({ ...result, playerTime: 63 }, { retry() {}, edit() {}, home() {} }).textContent)
      .toContain('GHOST WINS')
    expect(createResultsModal({ ...result, ghostSaved: false, ghostSaveFailed: true,
      savedGhostTime: 62.345 }, { retry() {}, edit() {}, home() {} }).textContent)
      .toContain('Replay could not be saved on this device.')
  })
})
