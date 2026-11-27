// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { AppCommand, AppSnapshot } from '@/application/appState'
import type { Preferences } from '@/application/ports/storage'
import { createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { createTrackLibraryModal } from '@/ui/modals/trackLibraryModal'
import {
  DomUiHost,
  type UiControllerPort,
} from '@/ui/uiHost'
import { createUiRuntime } from './uiRuntime'

const ready = createStarterTrack(asTrackId('ready'), 1)
const incomplete = {
  ...createStarterTrack(asTrackId('incomplete'), 2),
  name: 'Sketch',
  recoveryCheckpoints: [],
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
  it('offers hosting track selection without solo start or unrelated sharing actions', () => {
    const { root, port, update } = setup(state({ type: 'track-library', purpose: 'nearby-host' }))
    expect(root.textContent).toContain('Choose a track to host')
    expect(root.querySelector('[data-action="share-ready"]')).toBeNull()
    expect(root.querySelector('[data-action="send-nearby-ready"]')).toBeNull()
    expect(root.querySelector('[data-action="setup-start"]')).toBeNull()
    expect(root.querySelector('[data-action="select-race-ready"]')?.getAttribute('aria-label')).toBe('Host Starter Circuit')
    root.querySelector<HTMLButtonElement>('[data-action="select-race-ready"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'select-track-for-race', id: ready.id })
    update(state({ type: 'race-setup' }))
    expect(root.querySelector('[data-action="setup-start"]')).not.toBeNull()
    expect(root.querySelector('[data-action="host-nearby"]')).toBeNull()
  })

  it('chooses the track environment and shows its scenery in the editor', () => {
    const initial: AppSnapshot = { ...state({ type: 'editor-menu' }), mode: 'editor' }
    const { root, port, update, host } = setup(initial)
    const environment = root.querySelector<HTMLSelectElement>('[data-action="menu-environment"]')
    if (!environment) throw new Error('Missing environment selector')
    expect([...environment.options].map(option => option.textContent)).toEqual(['Grass', 'Cityscape', 'Desert', "Kids' Room"])
    expect(environment.value).toBe('grass')
    environment.value = 'kids-room'
    environment.dispatchEvent(new Event('change'))
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'editor', command: { type: 'set-environment', environmentId: 'kids-room' },
    })
    environment.value = 'cityscape'
    environment.dispatchEvent(new Event('change'))
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'editor', command: { type: 'set-environment', environmentId: 'cityscape' },
    })

    update({
      ...initial,
      overlay: { type: 'none' },
      editor: { ...initial.editor, environmentId: 'cityscape' },
      editorUi: { ...initial.editorUi, tool: 'tree', sceneryChoice: 'desert-cactus' },
    })
    expect(root.querySelector('[data-tool="tree"]')?.getAttribute('aria-label')).toBe('Scenery')
    expect(root.querySelector('[data-editor-context-dock]')?.getAttribute('data-layout')).toBe('two-row')
    expect(root.querySelector('[data-scenery-kind="tree"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelectorAll('[data-scenery-kind]')).toHaveLength(6)
    expect(root.querySelector('[data-scenery-kind="desert-cactus"]')).toBeNull()
    root.querySelector<HTMLButtonElement>('[data-scenery-kind="city-bus-stop"]')?.click()
    root.querySelector<HTMLButtonElement>('[aria-label="Erase scenery"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'set-editor-scenery', choice: 'city-bus-stop' })
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'set-editor-scenery', choice: 'erase-scenery' })
    update({
      ...initial,
      overlay: { type: 'none' },
      editor: { ...initial.editor, environmentId: 'kids-room' },
      editorUi: { ...initial.editorUi, tool: 'tree', sceneryChoice: 'tree' },
    })
    expect(root.querySelector('[data-scenery-kind="tree"]')).toBeNull()
    expect(root.querySelector('[data-scenery-kind="kids-blocks"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelectorAll('[data-scenery-kind]')).toHaveLength(7)
    expect(root.querySelector('.editor-scenery-choices-kids-room')).not.toBeNull()
    host.destroy()
  })

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

  it('keeps race readiness accessible without cluttering saved cards with times', async () => {
    const { root, port, host } = setup(
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
    expect(share?.textContent).toBe('SHARE')
    expect(share?.querySelector('svg path')).not.toBeNull()
    expect(raceTile?.firstElementChild?.classList.contains('track-preview')).toBe(true)
    expect(root.querySelectorAll('.track-list > .results-heading')).toHaveLength(0)
    expect(raceTile?.contains(share ?? null)).toBe(false)
    const overflow = share?.closest<HTMLDetailsElement>('details.track-card-overflow')
    expect(overflow).not.toBeNull()
    if (!overflow) throw new Error('Saved track share action must be in its overflow menu')
    overflow.open = true
    share?.click()
    expect(overflow.open).toBe(false)
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'open-track-share', track: ready, challenge: undefined })
    expect(root.querySelector('[data-action="export-ready"]')).toBeNull()
    expect(root.querySelector('[data-action^="select-race-"]')).not.toBeNull()
    expect(root.querySelector('.track-library-modal')?.textContent).not.toContain('01:02.345')
    expect(root.textContent).toContain('INCOMPLETE · Add checkpoints')
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
    host.destroy()
  })

  it('offers EDIT in the race picker even for an incomplete personal track', () => {
    const { root, port } = setup(state({ type: 'track-library', purpose: 'race' }))
    const edit = root.querySelector<HTMLButtonElement>('[data-action="edit-incomplete"]')
    const racing = root.querySelector<HTMLButtonElement>('[data-action="select-race-incomplete"]')
    expect(racing?.disabled).toBe(true)
    expect(edit?.getAttribute('aria-label')).toBe('Edit Sketch')
    const overflow = edit?.closest<HTMLDetailsElement>('details.track-card-overflow')
    if (!overflow) throw new Error('Missing incomplete track actions menu')
    overflow.open = true
    edit?.click()
    expect(overflow.open).toBe(false)
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'select-track-for-edit', id: incomplete.id })
    expect(port.dispatch).not.toHaveBeenCalledWith({ type: 'select-track-for-race', id: incomplete.id })
  })

  it('never overlaps the editor Tools and View drawers', () => {
    const { root, host } = setup({ ...state(), mode: 'editor' })
    const tools = root.querySelector<HTMLDetailsElement>('.editor-toolbox-drawer')
    const view = root.querySelector<HTMLDetailsElement>('.editor-view-drawer')
    if (!tools || !view) throw new Error('Missing editor drawers')
    tools.querySelector('summary')?.click()
    expect(tools.open).toBe(true)
    view.querySelector('summary')?.click()
    expect(view.open).toBe(true)
    expect(tools.open).toBe(false)
    tools.querySelector('summary')?.click()
    expect(tools.open).toBe(true)
    expect(view.open).toBe(false)
    tools.querySelector('summary')?.click()
    expect(tools.open).toBe(false)
    host.destroy()
  })

  it('keeps track management in one compact editor menu and the map title read-only', () => {
    const { root, port, host } = setup({ ...state({ type: 'editor-menu' }), mode: 'editor' })
    const menu = root.querySelector('[role="dialog"][aria-label="Editor menu"]')
    expect(menu?.querySelector('.editor-menu-name strong')?.textContent).toBe(ready.name)
    expect(root.querySelector('.topbar-title')?.tagName).toBe('SPAN')
    for (const action of ['editor-options', 'menu-choose', 'menu-export', 'rename-track']) {
      expect(root.querySelector(`[data-action="${action}"]`)).toBeNull()
    }
    expect(menu?.querySelector('[data-action="menu-share"] svg path')).not.toBeNull()
    menu?.querySelector<HTMLButtonElement>('[data-action="menu-rename"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'open-track-name', purpose: 'rename' })
    menu?.querySelector<HTMLButtonElement>('[data-action="menu-save-as"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'open-track-name', purpose: 'save-as' })
    const route = menu?.querySelector<HTMLSelectElement>('[data-action="menu-route-kind"]')
    if (!route) throw new Error('Missing route selector')
    expect(route.value).toBe('circuit')
    route.value = 'point-to-point'
    route.dispatchEvent(new Event('change'))
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'editor', command: { type: 'set-route-kind', routeKind: 'point-to-point' },
    })
    host.destroy()
  })

  it('shows Save As and view controls for a shared original', () => {
    const { root, port, host } = setup({
      ...state({ type: 'editor-menu' }),
      mode: 'editor', currentTrack: { ...ready, origin: 'imported' },
    })
    expect(root.querySelector('.status-pill')?.textContent).toContain('read-only')
    for (const action of ['save-track', 'clear-track', 'menu-save', 'menu-rename', 'menu-environment', 'undo', 'expand-track']) {
      expect(root.querySelector(`[data-action="${action}"]`)).toBeNull()
    }
    expect(root.querySelector('[data-action="zoom-in"]')).not.toBeNull()
    expect(root.querySelector('[data-action="save-as-track"]')?.getAttribute('aria-label')).toBe('Save as new track')
    root.querySelector<HTMLButtonElement>('[data-action="menu-save-as"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'open-track-name', purpose: 'save-as' })
    host.destroy()
  })

  it('offers RACE TRACK in the editor menu without starting racing directly', () => {
    const { root, port } = setup({ ...state({ type: 'editor-menu' }), mode: 'editor' })
    const button = root.querySelector<HTMLButtonElement>('[data-action="menu-race"]')
    expect(button?.textContent).toBe('RACE TRACK')
    button?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'race-current-track' })
    expect(port.dispatch).not.toHaveBeenCalledWith({ type: 'start-race' })
  })

  it('makes edit the main card action with a separate favorite star and overflow management', () => {
    const { root, port } = setup(state({ type: 'track-library', purpose: 'edit' }))
    const card = root.querySelector('.track-card')
    const actions = card?.querySelectorAll<HTMLButtonElement>('.track-icon-action')
    expect([...actions ?? []].map(action => action.textContent)).toEqual(['SHARE', 'DELETE'])
    for (const action of actions ?? []) {
      expect(action.querySelector('svg path')).not.toBeNull()
      expect(action.getAttribute('aria-label')).toBeTruthy()
    }
    const select = card?.querySelector('.track-card-select')
    expect(select?.children[0]?.classList.contains('track-preview')).toBe(true)
    expect(select?.children[1]?.classList.contains('track-card-copy')).toBe(true)
    expect(root.textContent).not.toContain('RACE READY')
    expect(root.textContent).not.toContain('BEST')
    expect(root.querySelector('[data-environment="grass"]')).not.toBeNull()
    const favorite = root.querySelector<HTMLButtonElement>('[data-action="favorite-incomplete"]')
    expect(favorite?.getAttribute('aria-pressed')).toBe('false')
    favorite?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'toggle-track-favorite', id: incomplete.id })
    expect(port.dispatch).not.toHaveBeenCalledWith({ type: 'select-track-for-edit', id: incomplete.id })
    root.querySelector<HTMLButtonElement>('[data-action="select-edit-ready"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'select-track-for-edit', id: ready.id })
  })

  it('only keeps one track overflow menu open at a time', () => {
    const { root } = setup(state({ type: 'track-library', purpose: 'edit' }))
    const menus = [...root.querySelectorAll<HTMLDetailsElement>('.track-card-overflow')]
    expect(menus).toHaveLength(2)
    const first = menus[0]
    const second = menus[1]
    if (!first || !second) throw new Error('Expected two track action menus')

    first.querySelector('summary')?.click()
    expect(first.open).toBe(true)
    second.querySelector('summary')?.click()
    expect(first.open).toBe(false)
    expect(second.open).toBe(true)
    first.querySelector('summary')?.click()
    expect(first.open).toBe(true)
    expect(second.open).toBe(false)
    first.querySelector('summary')?.click()
    expect(first.open).toBe(false)
  })

  it('shows favorite tracks first and labels environment colors without affecting modified dates', () => {
    const favorites = { ...state({ type: 'track-library', purpose: 'edit' }),
      preferences: { ...preferences, favoriteTrackIds: [ready.id] } }
    const { root } = setup(favorites)
    const cards = [...root.querySelectorAll('.track-card')]
    expect(cards[0]?.querySelector('[data-action="select-edit-ready"]')).not.toBeNull()
    expect(cards[0]?.querySelector('[data-action="favorite-ready"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(cards[0]?.querySelector('.track-environment-dot')?.getAttribute('title')).toBe('Grass')
    expect(cards[0]?.querySelector('.track-card-name')?.textContent).toBe('Starter Circuit')
  })

  it('filters the library by favorites and circuit or creator name', () => {
    const favoriteState = {
      ...state({ type: 'track-library', purpose: 'edit' }),
      tracks: [{ ...ready, creator: { id: 'creator-alex', name: 'Alex' } }, incomplete],
      preferences: { ...preferences, favoriteTrackIds: [ready.id] },
    }
    const { root } = setup(favoriteState)
    const favorites = root.querySelector<HTMLButtonElement>('[data-action="library-filter-favorites"]')
    favorites?.click()
    expect(favorites?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelectorAll('.track-card')).toHaveLength(1)
    expect(root.querySelector('[data-action="select-edit-ready"]')).not.toBeNull()

    const search = root.querySelector<HTMLInputElement>('[aria-label="Search tracks"]')
    const toggle = root.querySelector<HTMLButtonElement>('[data-action="library-search-toggle"]')
    if (!search || !toggle) throw new Error('Missing track search')
    expect(search.hidden).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).not.toBe(search)
    toggle.click()
    expect(search.hidden).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(search)
    search.value = 'Alex'
    search.dispatchEvent(new Event('input'))
    expect(root.querySelectorAll('.track-card')).toHaveLength(1)
    expect(root.querySelector('.track-card-creator')?.textContent).toContain('Alex')
    search.value = 'not found'
    search.dispatchEvent(new Event('input'))
    expect(root.querySelector('.track-list .empty-state')?.textContent).toBe('No circuits match this view.')
    root.querySelector<HTMLButtonElement>('[data-action="library-filter-all"]')?.click()
    expect(root.querySelectorAll('.track-card')).toHaveLength(0)
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(search.hidden).toBe(true)
    expect(search.value).toBe('')
    expect(root.querySelectorAll('.track-card')).toHaveLength(2)
    expect(document.activeElement).toBe(toggle)
  })

  it('restores active search on return from race setup and resets it on a new visit', () => {
    const initial = state({ type: 'track-library', purpose: 'race' })
    const { root, update, host } = setup(initial)
    root.querySelector<HTMLButtonElement>('[data-action="library-search-toggle"]')?.click()
    const search = root.querySelector<HTMLInputElement>('[aria-label="Search tracks"]')
    if (!search) throw new Error('Missing track search')
    search.value = 'Starter'
    search.dispatchEvent(new Event('input'))
    update(state({ type: 'race-setup' }))
    update(initial)
    expect(root.querySelector<HTMLInputElement>('[aria-label="Search tracks"]')?.value).toBe('Starter')
    expect(root.querySelector<HTMLInputElement>('[aria-label="Search tracks"]')?.hidden).toBe(false)
    update(state())
    update(initial)
    expect(root.querySelector<HTMLInputElement>('[aria-label="Search tracks"]')?.value).toBe('')
    expect(root.querySelector<HTMLInputElement>('[aria-label="Search tracks"]')?.hidden).toBe(true)
    host.destroy()
  })

  it('keeps the search query and favorites filter when a favorite update rerenders the library', () => {
    const initial = {
      ...state({ type: 'track-library', purpose: 'edit' }),
      tracks: [{ ...ready, creator: { id: 'creator-alex', name: 'Alex' } }, incomplete],
    }
    const { root, update, host } = setup(initial)
    root.querySelector<HTMLButtonElement>('[data-action="library-filter-favorites"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-action="library-search-toggle"]')?.click()
    const search = root.querySelector<HTMLInputElement>('[aria-label="Search tracks"]')
    if (!search) throw new Error('Missing track search')
    search.value = 'Alex'
    search.dispatchEvent(new Event('input'))

    update({ ...initial, preferences: { ...preferences, favoriteTrackIds: [ready.id] } })

    expect(root.querySelector<HTMLInputElement>('[aria-label="Search tracks"]')?.value).toBe('Alex')
    expect(root.querySelector<HTMLInputElement>('[aria-label="Search tracks"]')?.hidden).toBe(false)
    expect(root.querySelector<HTMLButtonElement>('[data-action="library-filter-favorites"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelectorAll('.track-card')).toHaveLength(1)
    expect(root.querySelector('[data-action="select-edit-ready"]')).not.toBeNull()
    host.destroy()
  })

  it('keeps imported shared tracks marked read-only and offers View as the main action', () => {
    const shared = { ...ready, id: asTrackId('shared-track'), origin: 'imported' as const }
    const { root, port } = setup({
      ...state({ type: 'track-library', purpose: 'edit' }),
      tracks: [shared],
    })
    expect(root.textContent).toContain('Shared original · read-only')
    expect(root.querySelector('[data-action="select-edit-shared-track"]')?.getAttribute('aria-label')).toBe('View Starter Circuit')
    root.querySelector<HTMLButtonElement>('[data-action="select-edit-shared-track"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({ type: 'select-track-for-edit', id: shared.id })
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
    expect(root.textContent).toContain('AI DIFFICULTY')
    expect(root.querySelector('[data-action="lighting-night"]')).toBeNull()
    for (const action of ['difficulty-hard', 'laps-3']) {
      expect(root.querySelector(`[data-action="${action}"]`)).not.toBeNull()
    }
    root.querySelector<HTMLButtonElement>('[data-action="difficulty-hard"]')?.click()
    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-preferences', preferences: { ...preferences, difficulty: 'hard' },
    })
  })

  it('keeps one full-height Options shell while switching tab panels', () => {
    const { root, host } = setup(state({ type: 'options', returnTo: 'home' }))
    const card = root.querySelector('.options-modal .modal-card')
    const body = root.querySelector('.options-modal .modal-body')
    const footer = root.querySelector('.options-modal .modal-footer')
    const tabs = root.querySelector('.options-modal .options-tab-list')
    expect(tabs?.parentElement).toBe(card)
    expect(body?.contains(tabs ?? null)).toBe(false)
    const race = root.querySelector<HTMLButtonElement>('[data-action="options-tab-race"]')
    const controls = root.querySelector<HTMLButtonElement>('[data-action="options-tab-controls"]')
    const audio = root.querySelector<HTMLButtonElement>('[data-action="options-tab-audio"]')
    if (!card || !body || !footer || !race || !controls || !audio) {
      throw new Error('Missing Options modal tabs or shell')
    }

    race.click()
    expect(race.getAttribute('aria-selected')).toBe('true')
    controls.click()
    expect(controls.getAttribute('aria-selected')).toBe('true')
    expect(root.querySelector<HTMLElement>('#options-panel-race')?.hidden).toBe(true)
    expect(root.querySelector<HTMLElement>('#options-panel-controls')?.hidden).toBe(false)
    audio.click()
    expect(audio.getAttribute('aria-selected')).toBe('true')
    expect(root.querySelector<HTMLElement>('#options-panel-controls')?.hidden).toBe(true)

    expect(root.querySelector('.options-modal .modal-card')).toBe(card)
    expect(root.querySelector('.options-modal .modal-body')).toBe(body)
    expect(root.querySelector('.options-modal .modal-footer')).toBe(footer)
    host.destroy()
  })

  it('separates display feedback from audio and remembers each tab scroll position', () => {
    const { root, host } = setup(state({ type: 'options', returnTo: 'home' }))
    const body = root.querySelector<HTMLElement>('.options-modal .modal-body')
    const race = root.querySelector<HTMLElement>('#options-panel-race')
    const audio = root.querySelector<HTMLElement>('#options-panel-audio')
    const display = root.querySelector<HTMLElement>('#options-panel-display')
    const controls = root.querySelector<HTMLElement>('#options-panel-controls')
    if (!body || !race || !audio || !display || !controls) {
      throw new Error('Missing Options categories')
    }

    expect(race.textContent).toContain('AI DIFFICULTY')
    expect(race.textContent).not.toContain('Race settings')
    expect(audio.querySelector('input[aria-label="Music"]')).not.toBeNull()
    expect(audio.querySelector('input[aria-label="Sound Effects"]')).not.toBeNull()
    expect(audio.textContent).not.toContain('Haptics')
    expect(display.textContent).toContain('Haptics')
    expect(display.textContent).toContain('Dynamic zoom')
    expect(controls.textContent).toContain('Steering layout')

    root.querySelector<HTMLButtonElement>('[data-action="options-tab-audio"]')?.click()
    body.scrollTop = 123
    root.querySelector<HTMLButtonElement>('[data-action="options-tab-display"]')?.click()
    expect(display.hidden).toBe(false)
    expect(audio.hidden).toBe(true)
    expect(body.scrollTop).toBe(0)
    body.scrollTop = 48
    root.querySelector<HTMLButtonElement>('[data-action="options-tab-audio"]')?.click()
    expect(body.scrollTop).toBe(123)
    root.querySelector<HTMLButtonElement>('[data-action="options-tab-display"]')?.click()
    expect(body.scrollTop).toBe(48)
    host.destroy()
  })

  it('shows comfort settings but hides race settings during a paused race', () => {
    const { root } = setup({ ...state({ type: 'options', returnTo: 'race' }), mode: 'race', paused: true })
    expect(root.querySelector('input[type="range"][aria-label="Music"]')).not.toBeNull()
    expect(root.querySelector('input[type="range"][aria-label="Sound Effects"]')).not.toBeNull()
    expect(root.querySelector('[data-action="difficulty-hard"]')).toBeNull()
    expect(root.querySelector('[data-action="options-tab-race"]')).toBeNull()
    expect(root.querySelector('[data-action="laps-3"]')).toBeNull()
    expect(root.querySelector('[data-action="pedalMode-manual"]')).not.toBeNull()
    expect(root.querySelector('[data-action="lighting-night"]')).toBeNull()
  })

  it('commits a music slider change independently of sound effects', () => {
    const { root, port } = setup(state({ type: 'options', returnTo: 'home' }))
    const music = root.querySelector<HTMLInputElement>('input[aria-label="Music"]')
    if (!music) throw new Error('Missing Music volume slider')

    music.value = '0'
    music.dispatchEvent(new Event('input', { bubbles: true }))
    expect(port.dispatch).not.toHaveBeenCalled()
    music.dispatchEvent(new Event('change', { bubbles: true }))

    expect(port.dispatch).toHaveBeenCalledWith({
      type: 'set-preferences',
      preferences: { ...preferences, musicVolume: 0 },
    })
  })

  it('retains the selected option focus and scroll position through a preferences update', () => {
    const initial = state({ type: 'options', returnTo: 'race-setup' })
    const { root, update, host } = setup(initial)
    root.querySelector<HTMLButtonElement>('[data-action="options-tab-controls"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-action="pedalMode-manual"]')?.focus()
    const body = root.querySelector<HTMLElement>('.modal-body')
    if (!body) throw new Error('Missing options body')
    body.scrollTop = 150

    update({ ...initial, preferences: { ...initial.preferences, pedalMode: 'manual' } })

    expect(document.activeElement?.getAttribute('data-action')).toBe('pedalMode-manual')
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

// System tracks are available to everyone and therefore have no share action.
it('hides share on built-in tracks but keeps it for player tracks', () => {
  const builtIn = { ...ready, id: asTrackId('system-starter-circuit'), origin: 'seeded' as const,
    creator: { id: 'trackforge-system', name: 'Track Forge' } }
  const own = { ...ready, id: asTrackId('my-track'), origin: 'local' as const,
    creator: { id: 'my-user-id-123', name: 'Me' } }
  const library = { ...state({ type: 'track-library', purpose: 'race' }),
    tracks: [builtIn, own], currentTrack: builtIn }
  const { root } = setup(library)
  expect(root.querySelector('[data-action="share-system-starter-circuit"]')).toBeNull()
  expect(root.querySelector('[data-action="share-my-track"]')).not.toBeNull()
  expect(root.textContent).toContain('Track Forge')
})

it('exposes only the unified Share action for personal tracks', () => {
  const seeded = {
    ...ready, id: asTrackId('system-starter-circuit'), origin: 'seeded' as const,
    creator: { id: 'trackforge-system', name: 'Track Forge' },
  }
  const personal = { ...ready, id: asTrackId('my-track'), origin: 'local' as const }
  const share = vi.fn()
  const modal = createTrackLibraryModal({
    ...state({ type: 'track-library', purpose: 'edit' }), tracks: [seeded, personal],
  }, {
    share, importFile: vi.fn(), close: vi.fn(), create: vi.fn(),
    selectForEdit: vi.fn(), selectForRace: vi.fn(), toggleFavorite: vi.fn(), delete: vi.fn(),
  }, new TrackGeometryService())
  expect(modal.querySelector('[data-action="share-system-starter-circuit"]')).toBeNull()
  expect(modal.querySelector('[data-action^="send-nearby-"]')).toBeNull()
  const menu = modal.querySelector<HTMLDetailsElement>('.track-card:has([data-action="share-my-track"]) .track-card-overflow')
  expect(menu).not.toBeNull()
  if (menu) menu.open = true
  modal.querySelector<HTMLButtonElement>('[data-action="share-my-track"]')?.click()
  expect(share).toHaveBeenCalledWith(personal)
  expect(menu?.open).toBe(false)
})
