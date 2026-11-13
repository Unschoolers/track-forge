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

const ready = createStarterTrack(asTrackId('ready'), 1)
const incomplete = {
  ...createStarterTrack(asTrackId('incomplete'), 2),
  name: 'Sketch',
  points: createStarterTrack(asTrackId('source'), 2).points.slice(0, 3),
}
const preferences: Preferences = {
  car: 'blue',
  difficulty: 'normal',
  audioEnabled: true,
  hapticsEnabled: true,
  dynamicZoomEnabled: true,
}

function state(
  overlay: AppSnapshot['overlay'] = { type: 'none' },
): AppSnapshot {
  return {
    mode: 'home',
    paused: false,
    overlay,
    tracks: [ready, incomplete],
    currentTrack: ready,
    editor: createEditorState(ready.points, ready.trees),
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
    scoresByTrack: {
      ready: [
        {
          time: 62.345,
          car: 'green',
          difficulty: 'hard',
          recordedAt: 10,
        },
      ],
    },
    notice: null,
  }
}

function setup(
  initial = state(),
  confirm: (message: string) => boolean = () => true,
) {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  let listener: ((snapshot: AppSnapshot) => void) | undefined
  const port: UiControllerPort = {
    snapshot: () => initial,
    dispatch: vi.fn<(command: AppCommand) => void>(),
    subscribe: (next) => {
      listener = next
      return () => {
        listener = undefined
      }
    },
  }
  const host = new DomUiHost(
    root,
    port,
    createUiRuntime(),
    { confirm },
  )
  host.mount()
  return {
    root,
    port,
    host,
    update: (snapshot: AppSnapshot) => listener?.(snapshot),
  }
}

describe('modal application flows', () => {
  it('opens track selection and options from the home screen', () => {
    const { root, port } = setup()

    root.querySelector<HTMLButtonElement>('[data-action="race"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-action="editor"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-action="options"]')?.click()

    expect(port.dispatch).toHaveBeenNthCalledWith(1, {
      type: 'open-track-library',
      purpose: 'race',
    })
    expect(port.dispatch).toHaveBeenNthCalledWith(2, {
      type: 'open-track-library',
      purpose: 'edit',
    })
    expect(port.dispatch).toHaveBeenNthCalledWith(3, {
      type: 'open-options',
      returnTo: 'home',
    })
  })

  it('renders readiness and best times in the race library', () => {
    const { root, port } = setup(
      state({ type: 'track-library', purpose: 'race' }),
    )

    expect(root.textContent).toContain('Starter Circuit')
    const raceTile = root.querySelector<HTMLButtonElement>('[data-action="select-race-ready"]')
    expect(raceTile?.getAttribute('aria-label')).toBe('Race Starter Circuit')
    expect(raceTile?.querySelector('svg path')).not.toBeNull()
    expect(root.querySelector('[data-action="select-race-incomplete"] svg path')).not.toBeNull()
    expect(root.querySelectorAll('.track-card svg.track-preview').length).toBeGreaterThan(2)
    const share = root.querySelector<HTMLButtonElement>('[data-action="share-ready"]')
    expect(share?.getAttribute('aria-label')).toBe('Share Starter Circuit')
    expect(share?.textContent).toBe('')
    expect(raceTile?.contains(share ?? null)).toBe(false)
    expect(root.querySelector('[data-action="export-ready"]')).toBeNull()
    expect(root.querySelector('[data-action^="select-race-"]')?.getAttribute('data-action')).toBe('select-race-ready')
    expect(root.textContent).toContain('01:02.345')
    expect(root.textContent).toContain('NEEDS EDITING')
    expect(
      root.querySelector<HTMLButtonElement>(
        '[data-action="select-race-incomplete"]',
      )?.disabled,
    ).toBe(true)

    root
      .querySelector<HTMLButtonElement>('[data-action="select-race-ready"]')
      ?.click()
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'select-track-for-race',
      id: ready.id,
    })
  })

  it('shows the selected car and lighting in the race setup flyover', () => {
    const initial = state({ type: 'race-setup' })
    const { root, host, update, port } = setup(initial)
    const preview = root.querySelector<HTMLCanvasElement>('canvas.race-flyover')
    expect(preview?.getAttribute('aria-label')).toBe('Daytime flyover of Starter Circuit')
    expect(preview?.dataset.car).toBe('blue')
    root.querySelector<HTMLButtonElement>('[data-action="lighting-night"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'set-race-lighting', lighting: 'night' })
    update({ ...initial, raceLighting: 'night', preferences: { ...initial.preferences, car: 'red' } })
    const night = root.querySelector<HTMLCanvasElement>('canvas.race-flyover')
    expect(night?.getAttribute('aria-label')).toBe('Nighttime flyover of Starter Circuit')
    expect(night?.dataset.car).toBe('red')
    update({ ...initial, overlay: { type: 'options', returnTo: 'race-setup' } })
    expect(root.querySelector('canvas.race-flyover')).toBeNull()
    host.destroy()
  })

  it('creates, renames, and confirms deletion through dialogs', () => {
    const confirm = vi.fn(() => true)
    const { root, port, update } = setup(
      state({ type: 'track-library', purpose: 'edit' }),
      confirm,
    )

    root.querySelector<HTMLButtonElement>('[data-action="new-track"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'open-track-name',
      purpose: 'create',
    })

    update(
      state({
        type: 'track-name',
        purpose: 'create',
        returnTo: { type: 'track-library', purpose: 'edit' },
      }),
    )
    const input = root.querySelector<HTMLInputElement>('[name="track-name"]')
    if (input) input.value = 'Coastal Run'
    root.querySelector<HTMLButtonElement>('[data-action="save-name"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'create-track',
      name: 'Coastal Run',
    })

    update(state({ type: 'track-library', purpose: 'edit' }))
    root
      .querySelector<HTMLButtonElement>('[data-action="delete-ready"]')
      ?.click()
    expect(confirm).toHaveBeenCalledWith('Delete "Starter Circuit"?')
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'delete-track',
      id: ready.id,
    })
  })

  it('moves race settings to options while keeping car and race mode in setup', () => {
    const { root, port, update } = setup(state({ type: 'race-setup' }))

    expect(root.querySelector('[data-car="green"]')).not.toBeNull()
    expect(root.querySelector('[data-action="mode-normal"]')).not.toBeNull()
    expect(root.querySelector('[data-action="difficulty-hard"]')).toBeNull()
    root.querySelector<HTMLButtonElement>('[data-action="setup-options"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'open-options', returnTo: 'race-setup' })

    update(state({ type: 'options', returnTo: 'race-setup' }))
    expect(root.textContent).toContain('Race settings')
    expect(root.querySelector('[data-action="lighting-night"]')).toBeNull()
    for (const action of ['difficulty-hard', 'laps-3', 'handling-simulation']) {
      expect(root.querySelector(`[data-action="${action}"]`)).not.toBeNull()
    }
    root.querySelector<HTMLButtonElement>('[data-action="difficulty-hard"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-preferences', preferences: { ...preferences, difficulty: 'hard' },
    })
  })

  it('shows comfort settings but hides race settings during a paused race', () => {
    const { root } = setup({ ...state({ type: 'options', returnTo: 'race' }), mode: 'race', paused: true })
    expect(root.querySelector('[data-action="toggle-audio"]')).not.toBeNull()
    expect(root.querySelector('[data-action="difficulty-hard"]')).toBeNull()
    expect(root.querySelector('[data-action="laps-3"]')).toBeNull()
    expect(root.querySelector('[data-action="handling-simulation"]')).toBeNull()
    expect(root.querySelector('[data-action="lighting-night"]')).toBeNull()
  })

  it('retains the selected option focus and scroll position through a preferences update', () => {
    const initial = state({ type: 'options', returnTo: 'race-setup' })
    const { root, update, host } = setup(initial)
    root.querySelector<HTMLButtonElement>('[data-action="handling-simulation"]')?.focus()
    const body = root.querySelector<HTMLElement>('.modal-body')
    if (!body) throw new Error('Missing options body')
    body.scrollTop = 150

    update({ ...initial, preferences: { ...initial.preferences, handling: 'simulation' } })

    expect(document.activeElement?.getAttribute('data-action')).toBe('handling-simulation')
    expect(root.querySelector<HTMLElement>('.modal-body')?.scrollTop).toBe(150)
    update(state({ type: 'race-setup' }))
    expect(document.activeElement?.getAttribute('data-action')).toBe('setup-options')
    host.destroy()
  })

  it('restores focus after Escape closes an allowed dialog', () => {
    const { root, port, update } = setup()
    const options =
      root.querySelector<HTMLButtonElement>('[data-action="options"]')
    options?.focus()
    update(state({ type: 'options', returnTo: 'home' }))

    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'close-overlay' })

    update(state())
    expect(document.activeElement?.getAttribute('data-action')).toBe(
      'options',
    )
  })
})
