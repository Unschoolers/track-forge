// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createRaceSetupModal } from '@/ui/modals/raceSetupModal'
import { createResultsModal } from '@/ui/modals/resultsModal'
import { createEditorState } from '@/domain/editor/editorState'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'
import type { AppSnapshot } from '@/application/appState'
import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import { createNearbyRaceModal } from '@/ui/modals/nearbyRaceModal'
import type { RaceResult } from '@/application/race/raceSession'

const track = createStarterTrack(asTrackId('ghost-ui'), 1)
const state: AppSnapshot = {
  mode: 'home', paused: false, overlay: { type: 'race-setup' },
  tracks: [track], currentTrack: track, editor: createEditorState(track.points, track.trees),
  editorUi: { tool: 'draw', surface: 'street', structure: 'overpass',
    terrainBrush: { mode: 'raise', radius: 48 }, grid: false, cameraRequest: null,
    selectedCrossing: null, selectedPoint: null },
  preferences: { car: 'blue', difficulty: 'normal',
    audioEnabled: true, hapticsEnabled: true, dynamicZoomEnabled: true },
  scoresByTrack: {}, notice: null,
}
const actions = () => ({ close: vi.fn(), preferences: vi.fn(), lighting: vi.fn(), start: vi.fn(), options: vi.fn() })
describe('Shared race preparation', () => {
  it('uses identical preview and car picker structure with distinct mode controls', () => {
    const preview = () => {
      const panel = document.createElement('div')
      panel.className = 'race-flyover-panel'
      return panel
    }
    const solo = createRaceSetupModal(state, actions(), null, preview())
    const nearby = {
      snapshot: () => ({
        phase: 'lobby', purpose: 'race', role: 'host', track: track.name,
        lobbyTrack: track, lighting: 'day', laps: 2, localCar: 'blue',
        localReady: false, readyPending: false, unlockPending: false,
        lobbyPlayers: [{ slot: 0, car: 'blue', name: 'Host', accepted: false, choice: 0 }],
      }),
      localSlot: () => 0, selectLobbyCar: vi.fn(), setLobbyReady: vi.fn(),
    } as unknown as NearbyRace
    const multi = createNearbyRaceModal(nearby, {
      close: vi.fn(), chooseTrack: vi.fn(), configureCup: vi.fn(), scan: vi.fn(), scanTracks: vi.fn(),
      saveTrack: vi.fn(), declineTrack: vi.fn(), connectByIp: vi.fn(), downloadDiagnostics: vi.fn(async () => true),
    }, undefined, preview())
    for (const modal of [solo, multi]) {
      expect(modal.classList.contains('race-preparation-modal')).toBe(true)
      expect(modal.querySelector('.race-preparation-body > .race-flyover-panel')).not.toBeNull()
      expect(modal.querySelectorAll('.race-preparation-picker .car-choice')).toHaveLength(4)
      expect(modal.querySelectorAll('.car-stat-meter .car-stat-segment')).toHaveLength(20)
    }
    expect(solo.querySelector('.race-preparation-picker')?.outerHTML).toEqual(multi.querySelector('.race-preparation-picker')?.outerHTML)
    expect(solo.querySelector('[data-action="setup-start"]')).not.toBeNull()
    expect(solo.querySelector('[data-action="nearby-ready"]')).toBeNull()
    expect(multi.querySelector('[data-action="nearby-ready"]')).not.toBeNull()
    expect(multi.querySelector('[data-action="setup-start"]')).toBeNull()
    expect(multi.querySelector('[data-action="mode-ghost"]')).toBeNull()
    expect(solo.querySelector('.nearby-lobby-roster')).toBeNull()
  })
})

describe('Ghost Race setup', () => {
  it('offers opt-in solo Boost Practice on circuit and point-to-point routes', () => {
    const callbacks = actions()
    const circuit = createRaceSetupModal(state, callbacks, null)
    const choice = circuit.querySelector<HTMLButtonElement>('[data-action="mode-boost-practice"]')
    expect(choice?.getAttribute('aria-pressed')).toBe('false')
    choice?.click()
    expect(callbacks.preferences).toHaveBeenCalledWith({ ...state.preferences, raceMode: 'boost-practice' })
    const selected = createRaceSetupModal({ ...state, preferences: { ...state.preferences, raceMode: 'boost-practice' } }, callbacks, null)
    expect(selected.textContent).toContain('unranked Arcade run')
    expect(selected.textContent).toContain('Tap and release BRAKE while turning at speed')
    expect(selected
      .querySelector('[data-action="setup-start"]')?.textContent).toBe('START BOOST PRACTICE')
    const open = createRaceSetupModal({ ...state, currentTrack: { ...track, routeKind: 'point-to-point' } }, callbacks, null)
    expect(open.querySelector('[data-action="mode-boost-practice"]')).not.toBeNull()
  })

  it('always shows a disabled Ghost Race button when no replay is available', () => {
    const modal = createRaceSetupModal(state, actions(), null)
    const ghost = modal.querySelector<HTMLButtonElement>('[data-action="mode-ghost"]')
    expect(ghost).not.toBeNull()
    expect(ghost?.hidden).toBe(false)
    expect(ghost?.disabled).toBe(true)
    expect(modal.textContent).toContain('Finish a race on this layout to save a ghost.')
    expect(modal.querySelector('[data-action="mode-normal"]')?.getAttribute('aria-pressed')).toBe('true')
  })
  it('describes a saved ghost with a different setup', () => {
    const modal = createRaceSetupModal(state, actions(), { kind: 'different-setup', setup: { car: 'green', laps: 1 } })
    expect(modal.textContent).toContain('Saved ghost: Green · 1 lap')
    expect(modal.querySelector<HTMLButtonElement>('[data-action="mode-ghost"]')?.disabled).toBe(true)
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
  it('offers and invokes the best ghost action when available', () => {
    const result: RaceResult = { outcome: 'finished', trackId: track.id, trackName: track.name,
      playerPlace: 1, playerTime: 61, newRecord: false, standings: [], highScores: [] }
    const raceBestGhost = vi.fn()
    const modal = createResultsModal(result, { retry() {}, edit() {}, home() {}, raceBestGhost })
    modal.querySelector<HTMLButtonElement>('[data-action="race-best-ghost"]')?.click()
    expect(raceBestGhost).toHaveBeenCalledOnce()
    expect(createResultsModal(result, { retry() {}, edit() {}, home() {} }).querySelector('[data-action="race-best-ghost"]')).toBeNull()
  })
  it('states Boost Practice is unranked without showing record or ghost save prompts', () => {
    const result: RaceResult = { mode: 'boost-practice', outcome: 'finished', trackId: track.id, trackName: track.name,
      playerPlace: 1, playerTime: 61, newRecord: false, standings: [], highScores: [] }
    const modal = createResultsModal(result, { retry() {}, edit() {}, home() {}, exportRace: vi.fn() })
    expect(modal.textContent).toContain('UNRANKED · BOOST ENABLED')
    expect(modal.textContent).toContain('NO RECORD OR GHOST SAVED')
    expect(modal.textContent).not.toContain('BEST GHOST SAVED')
    expect(modal.querySelector('.race-finish-medal')).toBeNull()
    expect(modal.querySelector('[data-action="race-diagnostics"]')).toBeNull()
  })
  it('compares the finish with the original ghost instead of awarding a solo-race medal', () => {
    const result: RaceResult = { outcome: 'finished', trackId: track.id, trackName: track.name,
      playerPlace: 1, playerTime: 61, newRecord: false,
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
  it('offers single-run modes and falls back from an unavailable ghost', () => {
    const openTrack = { ...track, routeKind: 'point-to-point' as const }
    const openState = { ...state, currentTrack: openTrack, preferences: { ...state.preferences, raceMode: 'ghost' as const } }
    const callbacks = actions()
    const modal = createRaceSetupModal(openState, callbacks, null)
    expect(modal.textContent).toContain('Single run')
    expect(modal.textContent).toContain('RACE AI')
    expect(modal.querySelector('[data-action="mode-time-trial"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(modal.querySelector<HTMLButtonElement>('[data-action="mode-ghost"]')?.disabled).toBe(true)
    modal.querySelector<HTMLButtonElement>('[data-action="mode-time-trial"]')?.click()
    expect(callbacks.preferences).toHaveBeenCalledWith({ ...openState.preferences, raceMode: 'time-trial' })
    const available = createRaceSetupModal(openState, callbacks, 62)
    expect(available.querySelector('[data-action="mode-ghost"]')?.getAttribute('aria-pressed')).toBe('true')
  })
  it('shows cumulative checkpoint and finish times in results', () => {
    const result: RaceResult = { outcome: 'finished', trackId: track.id, trackName: track.name,
      playerPlace: 1, playerTime: 61, newRecord: false, standings: [], highScores: [],
      routeKind: 'point-to-point', splits: [{ lap: 0, gate: 1, time: 15 }, { lap: 0, gate: 4, time: 61 }] }
    const modal = createResultsModal(result, { retry() {}, edit() {}, home() {} })
    document.body.append(modal)
    expect(modal.querySelectorAll('.results-splits-detail-row')).toHaveLength(0)
    modal.querySelector<HTMLButtonElement>('[data-action="open-race-splits"]')?.click()
    const rows = modal.querySelectorAll('.results-splits-detail-row')
    expect(rows).toHaveLength(2)
    expect(Array.from(rows.item(0)?.children ?? [], cell => cell.textContent)).toEqual(['CHECKPOINT 1', '00:15.000', '00:15.000'])
    expect(Array.from(rows.item(1)?.children ?? [], cell => cell.textContent)).toEqual(['FINISH', '00:46.000', '01:01.000'])
    modal.remove()
  })

})
