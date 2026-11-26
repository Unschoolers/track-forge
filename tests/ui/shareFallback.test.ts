// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { exportTrack, shareTrack } from '@/infrastructure/export/trackExport'
import type { AppSnapshot } from '@/application/appState'
import { createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { DomUiHost, type UiControllerPort } from '@/ui/uiHost'
import { createUiRuntime } from './uiRuntime'

vi.mock('@/infrastructure/export/trackExport', () => ({
  exportTrack: vi.fn(), saveJsonFile: vi.fn(), shareTrack: vi.fn(),
}))

const track = createStarterTrack(asTrackId('personal-share'), 1)
const state: AppSnapshot = {
  mode: 'home', paused: false,
  overlay: { type: 'track-library', purpose: 'edit' },
  tracks: [track], currentTrack: track,
  editor: createEditorState(track.points, track.trees),
  editorUi: {
    tool: 'draw', surface: 'street', structure: 'overpass',
    terrainBrush: { mode: 'raise', radius: 48 },
    grid: false, cameraRequest: null, selectedCrossing: null, selectedPoint: null,
  },
  preferences: { car: 'blue', difficulty: 'normal', audioEnabled: true, hapticsEnabled: true, dynamicZoomEnabled: true },
  scoresByTrack: {}, notice: null,
}

describe('track share fallback', () => {
  it('reports a failed native share and falls back to exporting the same track', async () => {
    const failure = new Error('Native share unavailable')
    vi.mocked(shareTrack).mockRejectedValueOnce(failure)
    vi.mocked(exportTrack).mockResolvedValueOnce(true)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const root = document.createElement('div')
    const controller: UiControllerPort = {
      snapshot: () => state, subscribe: () => () => undefined, dispatch: vi.fn(),
    }
    const host = new DomUiHost(root, controller, createUiRuntime())
    host.mount()
    try {
      const share = root.querySelector<HTMLButtonElement>('[data-action="share-personal-share"]')
      if (!share) throw new Error('Personal track share action missing')
      share.click()
      await vi.waitFor(() => {
        expect(exportTrack).toHaveBeenCalledWith(track, undefined)
        expect(errorLog).toHaveBeenCalledWith('Track Forge share failed:', failure)
      })
    } finally {
      host.destroy()
      errorLog.mockRestore()
    }
  })
})
