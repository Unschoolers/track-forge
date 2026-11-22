// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { AppCommand, AppSnapshot } from '@/application/appState'
import type { Preferences } from '@/application/ports/storage'
import type { UpdateProvider } from '@/application/updates/updateProvider'
import { createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import {
  DomUiHost,
  type UiControllerPort,
  type UiRuntime,
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

function setup(
  mode: AppSnapshot['mode'] = 'home',
  prepareRace?: UiRuntime['prepareRace'],
  updateProvider?: UpdateProvider,
) {
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
  const runtime = { ...createUiRuntime(), ...(prepareRace ? { prepareRace } : {}), ...(updateProvider ? { updateProvider } : {}) }
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
    expect(port.dispatch).toHaveBeenNthCalledWith(3, { type: 'open-cup' })
  })

  it('checks updates on Home, shows an actionable indicator, and does not check on each render', async () => {
    const check = vi.fn<UpdateProvider['check']>()
    let resolveCheck: (value: Awaited<ReturnType<UpdateProvider['check']>>) => void = () => { throw new Error('Update resolver not ready') }
    check.mockImplementation(() => new Promise((resolve) => { resolveCheck = resolve }))
    const { root, port, update } = setup('home', undefined, { check })
    expect(check).toHaveBeenCalledOnce()
    expect(root.querySelector('[data-action="open-updates"]')).toBeNull()

    resolveCheck({
      version: 'android-build-999-1',
      url: 'https://github.com/Unschoolers/track-forge/releases/latest',
      apkUrl: 'https://github.com/Unschoolers/track-forge/releases/download/android-build-999-1/trackforge-debug.apk',
    })
    await vi.waitFor(() => expect(root.querySelector('[data-action="open-updates"]')).not.toBeNull())
    const indicator = root.querySelector<HTMLButtonElement>('[data-action="open-updates"]')
    expect(indicator?.textContent).toContain('UPDATE AVAILABLE')
    indicator?.click()
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'open-options',
      returnTo: 'home',
      tab: 'updates',
    })

    update(snapshot('home'))
    update(snapshot('editor'))
    update(snapshot('home'))
    expect(check).toHaveBeenCalledOnce()
  })

  it('keeps Home clean when no newer release is available', async () => {
    const check = vi.fn<UpdateProvider['check']>().mockResolvedValue(null)
    const { root } = setup('home', undefined, { check })
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(root.querySelector('[data-action="open-updates"]')).toBeNull()
  })

  it('reports update check errors without incorrectly displaying an update', async () => {
    const error = new Error('Network offline')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { root } = setup('home', undefined, {
        check: vi.fn<UpdateProvider['check']>().mockRejectedValue(error),
      })
      await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('Track Forge automatic update check failed:', error))
      expect(root.querySelector('[data-action="open-updates"]')).toBeNull()
    } finally {
      spy.mockRestore()
    }
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

  it('offers explicit Save, Save As, Discard and Cancel actions when leaving editor', () => {
    const { root, port, update } = setup('editor')
    update({ ...snapshot('editor'), overlay: { type: 'editor-exit' } })
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Unsaved track changes')
    update({ ...snapshot('editor'), overlay: { type: 'editor-exit' }, notice: 'Save unavailable.' })
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Save unavailable.')
    expect(root.querySelector('.toast')).toBeNull()

    root.querySelector<HTMLButtonElement>('[data-action="editor-exit-save"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-action="editor-exit-save-as"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-action="editor-exit-discard"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-action="editor-exit-cancel"]')?.click()
    expect(vi.mocked(port.dispatch).mock.calls.map(([command]) => command)).toEqual([
      { type: 'resolve-editor-exit', choice: 'save' },
      { type: 'resolve-editor-exit', choice: 'save-as' },
      { type: 'resolve-editor-exit', choice: 'discard' },
      { type: 'resolve-editor-exit', choice: 'cancel' },
    ])

    update({ ...snapshot('editor'), overlay: {
      type: 'track-name', purpose: 'save-as', returnTo: { type: 'editor-exit' },
    } })
    const input = root.querySelector<HTMLInputElement>('#track-name-input')
    expect(input?.value).toBe('Starter Circuit Copy')
    if (!input) throw new Error('Missing Save As name input')
    input.value = 'My new circuit'
    root.querySelector<HTMLButtonElement>('[data-action="save-name"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'save-as-track', name: 'My new circuit' })
  })

  it('unsubscribes and removes UI on destroy', () => {
    const { root, host, port } = setup()
    host.destroy()
    expect(root.childElementCount).toBe(0)
    expect(port.subscribe).toHaveBeenCalledOnce()
  })

  it('reuses setup preparation across car changes and cancels it when rendering inputs change', () => {
    const cancelDay = vi.fn()
    const cancelNight = vi.fn()
    const cancelNextTrack = vi.fn()
    const prepareRace = vi.fn<NonNullable<UiRuntime['prepareRace']>>()
      .mockReturnValueOnce(cancelDay)
      .mockReturnValueOnce(cancelNight)
      .mockReturnValueOnce(cancelNextTrack)
    const { update, host, geometry } = setup('home', prepareRace)
    const raceSetup: AppSnapshot = { ...snapshot('home'), overlay: { type: 'race-setup' } }

    update(raceSetup)
    expect(prepareRace).toHaveBeenLastCalledWith(track, geometry.mock.results[0]?.value, 'day')
    update({ ...raceSetup, preferences: { ...preferences, car: 'red' } })
    expect(prepareRace).toHaveBeenCalledOnce()
    expect(cancelDay).not.toHaveBeenCalled()

    update({ ...raceSetup, raceLighting: 'night' })
    expect(cancelDay).toHaveBeenCalledOnce()
    expect(prepareRace).toHaveBeenLastCalledWith(track, geometry.mock.results[0]?.value, 'night')

    const nextTrack = createStarterTrack(asTrackId('next'), 2)
    update({ ...raceSetup, currentTrack: nextTrack, raceLighting: 'night' })
    expect(cancelNight).toHaveBeenCalledOnce()
    expect(prepareRace).toHaveBeenCalledTimes(3)

    update({ ...raceSetup, overlay: { type: 'options', returnTo: 'race-setup' } })
    expect(cancelNextTrack).toHaveBeenCalledOnce()
    host.destroy()
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
