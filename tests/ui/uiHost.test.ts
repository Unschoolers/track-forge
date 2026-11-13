import { describe, expect, it, vi } from 'vitest'
import type { AppCommand, AppSnapshot } from '@/application/appState'
import type { Preferences } from '@/application/ports/storage'
import { createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import {
  DomUiHost,
  type UiControllerPort,
} from '@/ui/uiHost'
import { createUiRuntime } from './uiRuntime'

const track = createStarterTrack(asTrackId('starter'), 1)
const preferences: Preferences = {
  car: 'blue',
  difficulty: 'normal',
  audioEnabled: true,
  hapticsEnabled: true,
  dynamicZoomEnabled: true,
}

function snapshot(mode: AppSnapshot['mode']): AppSnapshot {
  return {
    mode,
    paused: false,
    overlay: { type: 'none' },
    tracks: [track],
    currentTrack: track,
    editor: createEditorState(track.points, track.trees),
    preferences,
    editorUi: {
      tool: 'draw',
      surface: 'street',
      structure: 'overpass',
      terrainBrush: { mode: 'raise', radius: 48 },
      grid: false,
      cameraRequest: null,
      selectedCrossing: null,
      selectedPoint: null,
    },
    scoresByTrack: {},
    notice: null,
  }
}

function setup(mode: AppSnapshot['mode'] = 'home') {
  const root = document.createElement('div')
  let listener: ((value: AppSnapshot) => void) | undefined
  const port: UiControllerPort = {
    snapshot: () => snapshot(mode),
    dispatch: vi.fn<(command: AppCommand) => void>(),
    subscribe: vi.fn((next) => {
      listener = next
      return () => {
        listener = undefined
      }
    }),
  }
  const runtime = createUiRuntime()
  const geometry = vi.spyOn(runtime.geometry, 'get')
  const host = new DomUiHost(root, port, runtime)
  host.mount()
  return {
    root,
    port,
    host,
    geometry,
    update: (value: AppSnapshot) => listener?.(value),
  }
}

describe('DomUiHost', () => {
  it('derives one shared live geometry for an editor render', () => {
    const { geometry } = setup('editor')

    expect(geometry).toHaveBeenCalledOnce()
    expect(geometry.mock.calls[0]?.[0]).toMatchObject({
      points: track.points,
    })
  })

  it('renders semantic home actions and dispatches typed commands', () => {
    const { root, port } = setup()
    const race = root.querySelector<HTMLButtonElement>('[data-action="race"]')
    const editor =
      root.querySelector<HTMLButtonElement>('[data-action="editor"]')

    expect(root.querySelector('h1')?.textContent).toContain('TRACKFORGE')
    expect(race?.textContent).toContain('RACE')
    editor?.click()
    race?.click()
    root.querySelector<HTMLButtonElement>('[data-action="arcade-cup"]')?.click()

    expect(port.dispatch).toHaveBeenNthCalledWith(1, {
      type: 'open-track-library',
      purpose: 'edit',
    })
    expect(port.dispatch).toHaveBeenNthCalledWith(2, {
      type: 'open-track-library',
      purpose: 'race',
    })
    expect(port.dispatch).toHaveBeenNthCalledWith(3, { type: 'start-cup' })
  })

  it('updates to editor and race layouts without remounting the host', () => {
    const { root, port, update } = setup()
    update({ ...snapshot('editor'), notice: 'Close the circuit' })
    expect(root.querySelector('[data-screen="editor"]')).not.toBeNull()
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      'Close the circuit',
    )
    expect(root.querySelectorAll('[data-tool]').length).toBeGreaterThan(4)

    root.querySelector<HTMLButtonElement>('[data-tool="paint"]')?.click()
    root
      .querySelector<HTMLButtonElement>('[data-surface="mixed"]')
      ?.click()
    root.querySelector<HTMLButtonElement>('[data-action="fit-track"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-action="expand-track"]')?.click()

    expect(root.querySelector('[data-tool="draw"]')?.classList).toContain(
      'active',
    )
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-editor-tool',
      tool: 'paint',
    })
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-editor-surface',
      surface: 'mixed',
    })
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'request-editor-camera',
      action: 'fit',
    })
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'editor',
      command: { type: 'expand', factor: 2 },
    })

    update(snapshot('race'))
    expect(root.querySelector('[data-screen="race"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="Brake"]')).not.toBeNull()
  })

  it('unsubscribes and removes UI on destroy', () => {
    const { root, host, port } = setup()
    host.destroy()
    expect(root.childElementCount).toBe(0)
    expect(port.subscribe).toHaveBeenCalledOnce()
  })

  it('shows contextual at-grade and branch controls for a selected junction', () => {
    const { root, port, update } = setup('editor')
    const crossingTrack = {
      ...track,
      points: [
        { x: -120, y: -100, surface: 'street' as const },
        { x: 120, y: 100, surface: 'street' as const },
        { x: -120, y: 100, surface: 'street' as const },
        { x: 120, y: -100, surface: 'street' as const },
        { x: -120, y: -100, surface: 'street' as const },
      ],
    }
    update({
      ...snapshot('editor'),
      currentTrack: crossingTrack,
      tracks: [crossingTrack],
      editor: createEditorState(
        crossingTrack.points,
        crossingTrack.trees,
      ),
      editorUi: {
        ...snapshot('editor').editorUi,
        selectedCrossing: '0:2',
      },
    })

    const panel = root.querySelector('[data-crossing-control="0:2"]')
    expect(panel).not.toBeNull()
    expect(panel?.querySelectorAll('button')).toHaveLength(3)
    panel
      ?.querySelector<HTMLButtonElement>('[data-crossing-layer="second"]')
      ?.click()

    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'editor',
      command: {
        type: 'set-crossing-sections',
        firstSegment: 0,
        secondSegment: 2,
        upperSegment: 2,
      },
    })
  })

  it('shows SURFACE and OVERPASS brushes for the structure tool', () => {
    const { root, port, update } = setup('editor')
    update({
      ...snapshot('editor'),
      editorUi: {
        ...snapshot('editor').editorUi,
        tool: 'structure',
      },
    })

    const overpass = root.querySelector<HTMLButtonElement>(
      '[data-structure-brush="overpass"]',
    )
    expect(overpass).not.toBeNull()
    expect(
      root.querySelector('[data-structure-brush="surface"]'),
    ).not.toBeNull()
    expect(
      root.querySelector('[data-structure-brush="surface"]')?.textContent,
    ).toBe('SURFACE')
    expect(overpass?.textContent).toBe('OVERPASS')
    overpass?.click()
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-editor-structure',
      structure: 'overpass',
    })
  })
})
