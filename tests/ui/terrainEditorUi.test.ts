import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { AppCommand, AppSnapshot } from '@/application/appState'
import type { Preferences } from '@/application/ports/storage'
import { createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { DomUiHost, type UiControllerPort } from '@/ui/uiHost'
import { createUiRuntime } from './uiRuntime'

const track = createStarterTrack(asTrackId('terrain-ui'), 1)
const preferences: Preferences = {
  car: 'blue',
  difficulty: 'normal',
  lighting: 'day',
  audioEnabled: true,
  hapticsEnabled: true,
  dynamicZoomEnabled: true,
}

function terrainSnapshot(): AppSnapshot {
  return {
    mode: 'editor',
    paused: false,
    overlay: { type: 'none' },
    tracks: [track],
    currentTrack: track,
    editor: createEditorState(track.points, track.trees, undefined, track.terrain),
    preferences,
    editorUi: {
      tool: 'terrain',
      surface: 'street',
      structure: 'surface',
      terrainBrush: { mode: 'ground', radius: 96 },
      grid: false,
      cameraRequest: null,
      selectedCrossing: null,
      selectedPoint: null,
    },
    scoresByTrack: {},
    notice: null,
  }
}

function setup(snapshot = terrainSnapshot()) {
  const root = document.createElement('div')
  const port: UiControllerPort = {
    snapshot: () => snapshot,
    dispatch: vi.fn<(command: AppCommand) => void>(),
    subscribe: vi.fn(() => () => undefined),
  }
  const host = new DomUiHost(root, port, createUiRuntime())
  host.mount()
  return { root, port, host }
}

describe('terrain editor chrome', () => {
  it('renders a two-row terrain dock with four verb brushes and three radii', () => {
    const { root, host } = setup()

    expect(root.querySelector('[data-tool="terrain"]')).not.toBeNull()
    expect(root.querySelectorAll('[data-terrain-brush]')).toHaveLength(4)
    expect(root.querySelectorAll('[data-terrain-radius]')).toHaveLength(3)
    expect(
      root
        .querySelector('[data-editor-context-dock]')
        ?.getAttribute('data-layout'),
    ).toBe('two-row')
    expect(root.querySelector('[data-terrain-brush="raise"]')?.textContent).toBe(
      'RAISE',
    )
    expect(root.querySelector('[data-terrain-brush="lower"]')?.textContent).toBe(
      'LOWER',
    )
    expect(root.querySelector('[data-terrain-brush="water"]')?.textContent).toBe(
      'WATER',
    )
    expect(root.querySelector('[data-terrain-brush="ground"]')?.textContent).toBe(
      'GROUND',
    )
    expect(
      root
        .querySelector('[data-terrain-brush="ground"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      root
        .querySelector('[data-terrain-brush="lower"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false')

    host.destroy()
  })

  it('dispatches terrain kind and every radius action from the shared context dock', () => {
    const { root, port, host } = setup()

    root.querySelector<HTMLButtonElement>('[data-terrain-brush="raise"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-terrain-brush="lower"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-terrain-brush="water"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-terrain-radius="48"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-terrain-radius="96"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-terrain-radius="160"]')?.click()

    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-editor-terrain-mode',
      mode: 'raise',
    })
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-editor-terrain-mode',
      mode: 'lower',
    })
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-editor-terrain-mode',
      mode: 'water',
    })
    expect(port.dispatch).toHaveBeenNthCalledWith(4, {
      type: 'set-editor-terrain-radius',
      radius: 48,
    })
    expect(port.dispatch).toHaveBeenNthCalledWith(5, {
      type: 'set-editor-terrain-radius',
      radius: 96,
    })
    expect(port.dispatch).toHaveBeenNthCalledWith(6, {
      type: 'set-editor-terrain-radius',
      radius: 160,
    })

    host.destroy()
  })

  it('exposes the selected lower verb and world-unit brush radius truthfully', () => {
    const snapshot = terrainSnapshot()
    const { root, host } = setup({
      ...snapshot,
      editorUi: {
        ...snapshot.editorUi,
        terrainBrush: { mode: 'lower', radius: 48 },
      },
    })

    expect(
      root
        .querySelector('[data-terrain-brush="lower"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      root
        .querySelector('[data-terrain-brush="ground"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false')
    expect(
      root
        .querySelector('[data-terrain-radius="48"]')
        ?.getAttribute('aria-label'),
    ).toBe('48 world-unit brush radius')
    expect(
      root.querySelector('[data-terrain-radius="48"]')?.textContent,
    ).toContain('48')

    host.destroy()
  })

  it('shows diagnostics for unsaved terrain edits', () => {
    const snapshot = terrainSnapshot()
    const tree = track.trees[0]
    if (!tree) throw new Error('Expected starter scenery')
    const { root, host } = setup({
      ...snapshot,
      editor: createEditorState(
        track.points,
        track.trees,
        track.start,
        {
          cellSize: 32,
          cells: [
            {
              column: Math.floor(tree.x / 32),
              row: Math.floor(tree.y / 32),
              kind: 'water',
            },
          ],
        },
      ),
    })

    expect(
      [...root.querySelectorAll('.diagnostic-message')].map(
        (message) => message.textContent,
      ),
    ).toContain('Scenery stands in water.')

    host.destroy()
  })

  it('keeps editor targets at the mobile accessibility minimum', () => {
    const css = readFileSync('src/styles/components.css', 'utf8')
    const layoutCss = readFileSync('src/styles/layout.css', 'utf8')

    expect(css).toMatch(/\.tool-button[^}]*min-(?:height|block-size):\s*44px/)
    expect(css).toMatch(/\.surface-button[^}]*min-(?:height|block-size):\s*44px/)
    expect(layoutCss).toMatch(/\.race-controls\s*\{[^}]*position:\s*absolute/)
  })

  it('reserves short viewport diagnostic room above dock and track actions', () => {
    const layoutCss = readFileSync('src/styles/layout.css', 'utf8')

    expect(layoutCss).toMatch(
      /\.editor-screen\s*\{[^}]*--editor-context-dock-reserved-height:[^}]*--editor-context-dock-inset:[^}]*--editor-context-dock-clearance:\s*calc\(var\(--editor-context-dock-reserved-height\) \+ var\(--editor-context-dock-inset\)\)/,
    )
    expect(layoutCss).toMatch(
      /@media \(max-height: 700px\)\s*\{\s*\.diagnostic-panel\s*\{[^}]*max-block-size:\s*calc\(100svh - var\(--editor-diagnostic-top\) - var\(--editor-track-actions-clearance\)\);[^}]*overflow:\s*auto;/,
    )
    expect(layoutCss).not.toContain('max-block-size: calc(100svh - 19rem)')
  })

  it('reserves base selection panels above the shared dock and track clearance', () => {
    const css = readFileSync('src/styles/components.css', 'utf8')

    for (const panel of ['crossing-control', 'point-control', 'start-control']) {
      expect(css).toMatch(
        new RegExp(
          `\\.${panel}\\s*\\{[^}]*bottom:\\s*var\\(--editor-selection-panels-bottom\\)`,
        ),
      )
    }
    expect(css).not.toContain(
      'bottom: calc(7.2rem + env(safe-area-inset-bottom))',
    )
  })
})
