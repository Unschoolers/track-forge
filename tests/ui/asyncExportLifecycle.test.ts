// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { exportTrack } from '@/infrastructure/export/trackExport'
import { DomUiHost, type UiControllerPort } from '@/ui/uiHost'
import { createUiRuntime } from './uiRuntime'
import { createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
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
  overlay: { type: 'editor-menu' },
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

function setup() {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  const controller: UiControllerPort = {
    snapshot: () => state,
    dispatch: vi.fn(),
    subscribe: () => () => undefined,
  }
  const host = new DomUiHost(root, controller, createUiRuntime())
  host.mount()
  return { root, host }
}

describe('async UI export teardown', () => {
  it('does not reinsert a toast into an unmounted host when export finishes late', async () => {
    let finish: ((value: boolean) => void) | undefined
    vi.mocked(exportTrack).mockImplementationOnce(() =>
      new Promise(resolve => { finish = resolve }))
    const { root, host } = setup()
    const exportButton = root.querySelector<HTMLButtonElement>('[data-action="menu-export"]')
    if (!exportButton) throw new Error('Editor export button missing')
    exportButton.click()
    expect(exportTrack).toHaveBeenCalledWith(track)

    host.destroy()
    finish?.(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(root.childElementCount).toBe(0)
  })

  it('still displays a success notice when the host is mounted', async () => {
    vi.mocked(exportTrack).mockResolvedValueOnce(true)
    const { root, host } = setup()
    root.querySelector<HTMLButtonElement>('[data-action="menu-export"]')?.click()
    await vi.waitFor(() => expect(root.textContent).toContain('Track file saved.'))
    host.destroy()
  })
})
