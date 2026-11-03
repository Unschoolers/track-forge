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
  lighting: 'day',
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

  it('updates race setup and option preferences', () => {
    const { root, port, update } = setup(
      state({ type: 'race-setup' }),
    )

    expect(root.textContent).toContain('Balanced')
    root.querySelector<HTMLButtonElement>('[data-car="green"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-preferences',
      preferences: { ...preferences, car: 'green' },
    })

    root
      .querySelector<HTMLButtonElement>('[data-difficulty="hard"]')
      ?.click()
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-preferences',
      preferences: { ...preferences, difficulty: 'hard' },
    })

    update(
      state({ type: 'options', returnTo: 'home' }),
    )
    root
      .querySelector<HTMLButtonElement>('[data-action="toggle-audio"]')
      ?.click()
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-preferences',
      preferences: { ...preferences, audioEnabled: false },
    })
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
