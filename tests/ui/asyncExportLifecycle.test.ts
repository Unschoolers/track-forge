// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { exportTrack, saveJsonFile, shareTrack } from '@/infrastructure/export/trackExport'
import { DomUiHost, type UiControllerPort, type UiRuntime } from '@/ui/uiHost'
import { createUiRuntime } from './uiRuntime'
import { createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { RaceSession } from '@/application/race/raceSession'
import type { AppSnapshot } from '@/application/appState'

vi.mock('@/infrastructure/export/trackExport', () => ({
  exportTrack: vi.fn(),
  saveJsonFile: vi.fn(),
  shareTrack: vi.fn(),
}))

const track = createStarterTrack(asTrackId('async-export'), 10)
const state: AppSnapshot = {
  mode: 'editor',
  paused: false,
  overlay: { type: 'track-share', track, returnTo: { type: 'editor-menu' } },
  tracks: [track],
  currentTrack: track,
  editor: createEditorState(track.points, track.trees),
  preferences: { car: 'blue', difficulty: 'normal', audioEnabled: true, hapticsEnabled: true, dynamicZoomEnabled: true },
  editorUi: {
    tool: 'draw', surface: 'street', structure: 'overpass',
    terrainBrush: { mode: 'raise', radius: 48 },
    grid: false, cameraRequest: null, selectedCrossing: null, selectedPoint: null,
  },
  scoresByTrack: {},
  notice: null,
}

function setup(snapshot = state, runtime: UiRuntime = createUiRuntime()) {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  const controller: UiControllerPort = {
    snapshot: () => snapshot,
    dispatch: vi.fn(),
    subscribe: () => () => undefined,
  }
  const host = new DomUiHost(root, controller, runtime)
  host.mount()
  return { root, host, controller }
}

describe('async UI export teardown', () => {
  it('does not export when the shared track workflow succeeds', async () => {
    vi.mocked(exportTrack).mockClear()
    vi.mocked(shareTrack).mockResolvedValueOnce(true)
    const { root, host } = setup()
    root.querySelector<HTMLButtonElement>('[data-action="share-export"]')?.click()
    await Promise.resolve()
    expect(shareTrack).toHaveBeenCalledWith(track, expect.any(String), undefined)
    expect(exportTrack).not.toHaveBeenCalled()
    host.destroy()
  })
  it('does not reinsert a toast into an unmounted host when export finishes late', async () => {
    let finish: ((value: boolean) => void) | undefined
    vi.mocked(exportTrack).mockImplementationOnce(() =>
      new Promise(resolve => { finish = resolve }))
    vi.mocked(shareTrack).mockResolvedValueOnce(false)
    const { root, host } = setup()
    const exportButton = root.querySelector<HTMLButtonElement>('[data-action="share-export"]')
    if (!exportButton) throw new Error('Editor export button missing')
    exportButton.click()
    expect(shareTrack).toHaveBeenCalledWith(track, expect.any(String), undefined)
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(exportTrack).toHaveBeenCalledWith(track, undefined)

    host.destroy()
    finish?.(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(root.childElementCount).toBe(0)
  })

  it('ignores an export from a previous mount after the same host is remounted', async () => {
    let finish: ((value: boolean) => void) | undefined
    vi.mocked(exportTrack).mockImplementationOnce(() =>
      new Promise(resolve => { finish = resolve }))
    vi.mocked(shareTrack).mockResolvedValueOnce(false)
    const { root, host } = setup()
    const exportButton = root.querySelector<HTMLButtonElement>('[data-action="share-export"]')
    if (!exportButton) throw new Error('Editor export button missing')
    exportButton.click()
    await vi.waitFor(() => expect(finish).toBeDefined())

    host.destroy()
    host.mount()
    finish?.(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(root.textContent).not.toContain('Track file saved.')
    host.destroy()
  })

  it('still displays a success notice when the host is mounted', async () => {
    vi.mocked(exportTrack).mockResolvedValueOnce(true)
    vi.mocked(shareTrack).mockResolvedValueOnce(false)
    const { root, host } = setup()
    root.querySelector<HTMLButtonElement>('[data-action="share-export"]')?.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Track file saved.'))
    host.destroy()
  })
})

it('saves an unfinished race and current performance from the pause menu without dispatching navigation', async () => {
  const runtime = createUiRuntime()
  const session = new RaceSession({
    scoreStore: { forTrack: () => [], record: vi.fn(() => true), removeTrack: vi.fn(() => true) },
    random: { next: () => 0.5 }, feedback: runtime.feedback, geometry: runtime.geometry,
  })
  session.start(track, { car: 'blue', difficulty: 'normal', laps: 2 })
  session.setPaused(true)
  const performance = { timings: { frames: [[0, 16, 2, 1, 3]] } }
  vi.mocked(saveJsonFile).mockClear()
  vi.mocked(saveJsonFile).mockResolvedValueOnce(true)
  const { root, host, controller } = setup({ ...state, mode: 'race', paused: true, overlay: { type: 'pause' } }, {
    ...runtime, raceSession: session, frameDiagnostics: () => performance,
  })
  try {
    const exportButton = root.querySelector<HTMLButtonElement>('[data-action="export-race-diagnostics"]')
    expect(exportButton).not.toBeNull()
    exportButton?.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Race replay file saved.'))
    const request = vi.mocked(saveJsonFile).mock.calls[0]?.[0]
    expect(request?.filename).toMatch(/^trackforge-race-/)
    expect(JSON.parse(request?.content ?? '')).toMatchObject({ formatVersion: 1, result: null, performance })
    expect(controller.dispatch).not.toHaveBeenCalled()
    expect(session.snapshot().state?.paused).toBe(true)
  } finally {
    host.destroy()
    session.destroy()
  }
})
