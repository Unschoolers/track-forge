import { describe, expect, it, vi } from 'vitest'
import type {
  Preferences,
  PreferencesStore,
  ScoreStore,
  TrackStore,
} from '@/application/ports/storage'
import {
  AppController,
  type Scheduler,
} from '@/application/appController'
import { asTrackId, type Track, type TrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { RaceSession, type RaceSessionPort } from '@/application/race/raceSession'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { normalizeTerrain } from '@/domain/terrain/terrainField'
import { BrowserTrackRepository } from '@/infrastructure/storage/trackRepository'
import { STORAGE_KEYS } from '@/infrastructure/storage/storageKeys'
import { TERRAIN_LIMITS } from '@/domain/config'

class TrackMemory implements TrackStore {
  readonly tracks = new Map<TrackId, Track>()
  save = vi.fn((track: Track) => {
    this.tracks.set(track.id, track)
    return true
  })
  list = () => [...this.tracks.values()]
  find = (id: TrackId) => this.tracks.get(id)
  remove = (id: TrackId) => this.tracks.delete(id)
}

const preferences: Preferences = {
  car: 'blue',
  difficulty: 'normal',
  lighting: 'day',
  audioEnabled: true,
  hapticsEnabled: true,
  dynamicZoomEnabled: true,
}

function setup(track = createStarterTrack(asTrackId('starter'), 1), realRace = false) {
  const trackStore = new TrackMemory()
  trackStore.tracks.set(track.id, track)
  const preferencesStore: PreferencesStore = {
    load: () => preferences,
    save: vi.fn(() => true),
  }
  const scoreStore: ScoreStore = {
    forTrack: vi.fn(() => []),
    record: vi.fn(() => true),
    removeTrack: vi.fn(() => true),
  }
  let pending: (() => void) | undefined
  const cancel = vi.fn()
  const scheduler: Scheduler = {
    schedule: vi.fn((_delay, task) => {
      pending = task
      return cancel
    }),
  }
  const raceSession: RaceSessionPort = {
    start: vi.fn(),
    restart: vi.fn(),
    resetPlayer: vi.fn(),
    setPaused: vi.fn(),
    advance: vi.fn(),
    snapshot: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    destroy: vi.fn(),
  }
  const session = realRace ? new RaceSession({
    scoreStore,
    random: { next: () => 0.5 },
    feedback: { unlock: vi.fn(), setEnabled: vi.fn(), handle: vi.fn(), silenceContinuous: vi.fn(), destroy: vi.fn() },
    step: (state) => ({
      state: { ...state, phase: 'finished', vehicles: state.vehicles.map((vehicle) => vehicle.player ? { ...vehicle, finishedAt: 12.5 } : vehicle) },
      events: [{ type: 'race-finished', reason: 'finished' }],
    }),
  }) : raceSession
  const controller = new AppController({
    trackStore,
    preferencesStore,
    scoreStore,
    scheduler,
    raceSession: session,
    geometry: new TrackGeometryService(),
    createTrackId: () => asTrackId('created'),
    now: () => 500,
  })
  return {
    controller,
    trackStore,
    scoreStore,
    preferencesStore,
    scheduler,
    cancel,
    raceSession: session,
    flush: () => pending?.(),
  }
}

describe('AppController', () => {
  it('shows an official race record on Home without adding the circuit to saved tracks', () => {
    const { controller, raceSession, scoreStore } = setup(undefined, true)
    let scores: ReturnType<ScoreStore['forTrack']> = []
    vi.mocked(scoreStore.forTrack).mockImplementation((id) => id === 'official-meadow' ? scores : [])
    vi.mocked(scoreStore.record).mockImplementation((_id, score) => { scores = [score]; return true })
    controller.dispatch({ type: 'select-track-for-race', id: asTrackId('official-meadow') })
    controller.dispatch({ type: 'start-race' })
    const input = { steering: 0, throttle: 1, braking: false }
    raceSession.advance(3.7, input)
    raceSession.advance(0.02, input)
    controller.dispatch({ type: 'go-home' })
    expect(controller.snapshot().scoresByTrack['official-meadow']?.[0]?.time).toBe(12.5)
    expect(controller.snapshot().tracks.map((track) => track.id)).toEqual(['starter'])
  })

  it('runs the cup from Home, retries without duplicate points, and restores the saved track', () => {
    const { controller, raceSession, trackStore } = setup(undefined, true)
    const input = { steering: 0, throttle: 1, braking: false }
    const finish = () => { raceSession.advance(3.7, input); raceSession.advance(0.02, input) }
    controller.dispatch({ type: 'start-cup' })
    expect(controller.snapshot()).toMatchObject({ mode: 'race', cup: { index: 0 }, currentTrack: { id: 'official-meadow' } })
    expect(raceSession.snapshot().setup).toMatchObject({ mode: 'normal', handling: 'arcade', laps: 1 })
    finish()
    const first = controller.snapshot().cup
    expect(first?.rounds).toHaveLength(1)
    controller.dispatch({ type: 'restart-race' })
    expect(controller.snapshot().cup?.rounds).toHaveLength(0)
    finish()
    expect(controller.snapshot().cup?.rounds).toEqual(first?.rounds)
    for (const id of ['official-hairpin', 'official-frost', 'official-bridge']) {
      controller.dispatch({ type: 'next-cup-race' })
      expect(controller.snapshot().currentTrack?.id).toBe(id)
      finish()
    }
    expect(controller.snapshot().cup?.rounds).toHaveLength(4)
    controller.dispatch({ type: 'next-cup-race' })
    expect(controller.snapshot()).toMatchObject({ mode: 'home', currentTrack: { id: 'starter' }, cup: null })
    expect(trackStore.list().map((track) => track.id)).toEqual(['starter'])
  })


  it('publishes immutable snapshots and coordinates mode transitions', () => {
    const { controller, raceSession } = setup()
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'start-race' })
    controller.dispatch({ type: 'pause-race' })

    expect(controller.snapshot()).toMatchObject({
      mode: 'race',
      paused: true,
      currentTrack: { name: 'Starter Circuit' },
    })
    expect(listener).toHaveBeenCalledTimes(3)
    expect(raceSession.start).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Starter Circuit' }),
      expect.objectContaining({ car: 'blue', difficulty: 'normal', laps: 2, handling: 'arcade' }),
    )
    expect(raceSession.setPaused).toHaveBeenCalledWith(true)
    unsubscribe()
  })

  it('resumes and restarts the same authoritative race session', () => {
    const { controller, raceSession } = setup()
    controller.dispatch({ type: 'start-race' })
    controller.dispatch({ type: 'pause-race' })
    controller.dispatch({ type: 'resume-race' })
    controller.dispatch({ type: 'restart-race' })

    expect(raceSession.setPaused).toHaveBeenLastCalledWith(false)
    expect(raceSession.restart).toHaveBeenCalledOnce()
  })

  it('stops the active race when quitting to home', () => {
    const { controller, raceSession } = setup()
    controller.dispatch({ type: 'start-race' })
    controller.dispatch({ type: 'pause-race' })

    controller.dispatch({ type: 'go-home' })

    expect(raceSession.setPaused).toHaveBeenLastCalledWith(true)
    expect(raceSession.setPaused).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().mode).toBe('home')
  })

  it('returns from finished results to the existing editor and silences the race', () => {
    const { controller, raceSession, trackStore } = setup(undefined, true)
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'start-race' })
    const input = { steering: 0, throttle: 1, braking: false }
    raceSession.advance(3.7, input)
    raceSession.advance(0.02, input)
    expect(controller.snapshot()).toMatchObject({ mode: 'race', paused: true, overlay: { type: 'results' } })

    controller.dispatch({ type: 'open-editor' })

    expect(controller.snapshot()).toMatchObject({ mode: 'editor', paused: false, overlay: { type: 'none' }, currentTrack: { id: 'starter' } })
    expect(raceSession.snapshot().state?.paused).toBe(true)
    expect(trackStore.find(asTrackId('starter'))?.trees).toContainEqual({ x: 4, y: 5 })
    expect(controller.snapshot().editor.trees).toContainEqual({ x: 4, y: 5 })
    controller.dispatch({ type: 'editor', command: { type: 'undo' } })
    expect(controller.snapshot().editor.trees).not.toContainEqual({ x: 4, y: 5 })
  })

  it('retries a finished race and returns home from its results', () => {
    const { controller, raceSession } = setup(undefined, true)
    const input = { steering: 0, throttle: 1, braking: false }
    controller.dispatch({ type: 'start-race' })
    raceSession.advance(3.7, input)
    raceSession.advance(0.02, input)
    expect(controller.snapshot().overlay.type).toBe('results')
    controller.dispatch({ type: 'restart-race' })
    expect(controller.snapshot()).toMatchObject({ mode: 'race', paused: false, overlay: { type: 'none' } })
    expect(raceSession.snapshot().result).toBeNull()
    raceSession.advance(3.7, input)
    raceSession.advance(0.02, input)
    expect(controller.snapshot().overlay.type).toBe('results')
    controller.dispatch({ type: 'go-home' })
    expect(controller.snapshot()).toMatchObject({ mode: 'home', paused: false, overlay: { type: 'none' } })
    expect(raceSession.snapshot().state?.paused).toBe(true)
  })

  it('keeps an incomplete track in the editor instead of starting a race', () => {
    const incomplete = {
      ...createStarterTrack(asTrackId('short'), 1),
      points: createStarterTrack(asTrackId('source'), 1).points.slice(0, 3),
    }
    const { controller } = setup(incomplete)

    controller.dispatch({ type: 'start-race' })

    expect(controller.snapshot()).toMatchObject({
      mode: 'editor',
      notice: 'Add more road to complete the circuit',
    })
  })

  it('debounces editor persistence through the injected scheduler', () => {
    const { controller, trackStore, scheduler, cancel, flush } = setup()
    controller.dispatch({
      type: 'editor',
      command: { type: 'add-tree', tree: { x: 4, y: 5 } },
    })
    controller.dispatch({
      type: 'editor',
      command: { type: 'add-tree', tree: { x: 7, y: 8 } },
    })

    expect(scheduler.schedule).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledOnce()
    expect(trackStore.save).not.toHaveBeenCalled()

    flush()
    expect(trackStore.save).toHaveBeenCalledOnce()
    expect(trackStore.save.mock.calls[0]?.[0].trees).toHaveLength(9)
  })

  it('preserves pending edits when renaming a track', () => {
    const { controller, trackStore, flush } = setup()
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'rename-track', name: 'Renamed' })
    flush()
    expect(trackStore.find(asTrackId('starter'))).toMatchObject({ name: 'Renamed', trees: expect.arrayContaining([{ x: 4, y: 5 }]) })
  })

  it.each(['select-track', 'select-track-for-edit', 'select-track-for-race'] as const)(
    'preserves pending edits before %s', (type) => {
      const { controller, trackStore } = setup()
      const other = createStarterTrack(asTrackId('other'), 2)
      trackStore.tracks.set(other.id, other)
      controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
      controller.dispatch({ type, id: other.id })
      expect(trackStore.find(asTrackId('starter'))?.trees).toContainEqual({ x: 4, y: 5 })
    },
  )

  it('preserves pending edits before creating a track', () => {
    const { controller, trackStore } = setup()
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'create-track', name: 'New Track' })
    expect(trackStore.find(asTrackId('starter'))?.trees).toContainEqual({ x: 4, y: 5 })
  })

  it('flushes pending edits on destroy', () => {
    const { controller, trackStore } = setup()
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.destroy()
    expect(trackStore.find(asTrackId('starter'))?.trees).toContainEqual({ x: 4, y: 5 })
  })

  it.each([false, true])('recovers quota by deleting another track (still insufficient: %s)', (stillInsufficient) => {
    const current = createStarterTrack(asTrackId('current'), 2)
    const other = createStarterTrack(asTrackId('other'), 1)
    const values = new Map<string, string>([[STORAGE_KEYS.trackMigration, '1']])
    let limit = Infinity
    const store = new BrowserTrackRepository({
      get: (key) => values.get(key) ?? null,
      set: (key, value) => { if (key === STORAGE_KEYS.tracks && value.length > limit) return false; values.set(key, value); return true },
      remove: (key) => values.delete(key),
    })
    expect(store.save(current)).toBe(true)
    expect(store.save(other)).toBe(true)
    limit = stillInsufficient ? JSON.stringify([store.find(current.id)]).length : (values.get(STORAGE_KEYS.tracks) ?? '').length
    const { controller, scoreStore, scheduler, raceSession } = setup()
    controller.destroy()
    const app = new AppController({ trackStore: store, scoreStore, scheduler, raceSession, preferencesStore: { load: () => preferences, save: () => true }, geometry: new TrackGeometryService(), createTrackId: () => asTrackId('new'), now: () => 500 })
    app.dispatch({ type: 'open-editor' })
    app.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    expect(app.flushPendingEditorSave()).toBe(false)
    app.dispatch({ type: 'open-track-library', purpose: 'edit' })
    expect(app.snapshot()).toMatchObject({ overlay: { type: 'track-library' }, notice: 'Save unavailable.' })
    app.dispatch({ type: 'select-track-for-edit', id: other.id })
    expect(app.snapshot().currentTrack?.id).toBe(current.id)
    app.dispatch({ type: 'delete-track', id: other.id })
    expect(store.find(other.id)).toBeUndefined()
    expect(app.snapshot().currentTrack?.trees).toContainEqual({ x: 4, y: 5 })
    expect(app.snapshot().notice).toBe(stillInsufficient ? 'Save unavailable.' : null)
    if (stillInsufficient) {
      app.dispatch({ type: 'close-overlay' })
      expect(app.snapshot().notice).toBe('Save unavailable.')
      limit = Infinity
      expect(app.flushPendingEditorSave()).toBe(true)
    }
    expect(store.find(current.id)?.trees).toContainEqual({ x: 4, y: 5 })
    app.dispatch({ type: 'editor', command: { type: 'undo' } })
    expect(app.snapshot().currentTrack?.trees).not.toContainEqual({ x: 4, y: 5 })
  })

  it('retains a failed pending save for retry and blocks replacing the draft', () => {
    const { controller, trackStore } = setup()
    const other = createStarterTrack(asTrackId('other'), 2)
    trackStore.tracks.set(other.id, other)
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    trackStore.save.mockReturnValueOnce(false)
    controller.dispatch({ type: 'select-track', id: other.id })
    expect(controller.snapshot().currentTrack?.id).toBe('starter')
    expect(controller.snapshot().notice).toBe('Save unavailable.')
    controller.dispatch({ type: 'save-current-track' })
    expect(trackStore.find(asTrackId('starter'))?.trees).toContainEqual({ x: 4, y: 5 })
    expect(controller.snapshot().notice).toBe('Track saved.')
  })

  it('clears a failure notice after a later successful flush', () => {
    const { controller, trackStore, flush } = setup()
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    trackStore.save.mockReturnValueOnce(false)
    flush()
    expect(controller.snapshot().notice).toBe('Save unavailable.')
    expect(controller.flushPendingEditorSave()).toBe(true)
    expect(controller.snapshot().notice).toBeNull()
    expect(trackStore.find(asTrackId('starter'))?.trees).toContainEqual({ x: 4, y: 5 })
  })

  it('clears a failed draft save notice when a lighting save succeeds', () => {
    const { controller, trackStore, flush } = setup()
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    trackStore.save.mockReturnValueOnce(false)
    flush()
    expect(controller.snapshot().notice).toBe('Save unavailable.')

    controller.dispatch({ type: 'set-preferences', preferences: { ...preferences, lighting: 'night' } })

    expect(trackStore.find(asTrackId('starter'))).toMatchObject({
      lighting: 'night', trees: expect.arrayContaining([{ x: 4, y: 5 }]),
    })
    expect(controller.snapshot().notice).toBeNull()
  })

  it('does not resurrect a deleted track when a canceled callback runs', () => {
    const { controller, trackStore, flush } = setup()
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'delete-track', id: asTrackId('starter') })
    flush()
    expect(trackStore.find(asTrackId('starter'))).toBeUndefined()
  })

  it('does not overwrite newer lighting with a pending editor save', () => {
    const { controller, trackStore, flush } = setup()
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'set-preferences', preferences: { ...preferences, lighting: 'night' } })
    flush()
    expect(trackStore.find(asTrackId('starter'))).toMatchObject({ lighting: 'night', trees: expect.arrayContaining([{ x: 4, y: 5 }]) })
  })

  it('persists preference changes through the injected repository', () => {
    const { controller, preferencesStore, trackStore } = setup()

    controller.dispatch({
      type: 'set-preferences',
      preferences: { ...preferences, car: 'green', audioEnabled: false },
    })

    expect(preferencesStore.save).toHaveBeenCalledWith({
      ...preferences,
      car: 'green',
      audioEnabled: false,
    })
    expect(controller.snapshot().preferences.car).toBe('green')

    controller.dispatch({
      type: 'set-preferences',
      preferences: { ...preferences, lighting: 'night' },
    })
    expect(controller.snapshot().currentTrack?.lighting).toBe('night')
    expect(trackStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: 'night', updatedAt: 500 }),
    )
  })

  it('creates and renames tracks through typed library commands', () => {
    const { controller, trackStore } = setup()

    controller.dispatch({ type: 'open-track-library', purpose: 'edit' })
    expect(controller.snapshot().overlay).toEqual({
      type: 'track-library',
      purpose: 'edit',
    })

    controller.dispatch({ type: 'create-track', name: '  Alpine   Loop ' })
    expect(controller.snapshot()).toMatchObject({
      mode: 'editor',
      overlay: { type: 'none' },
      currentTrack: { id: 'created', name: 'Alpine Loop' },
    })
    expect(trackStore.find(asTrackId('created'))?.points).toEqual([])

    controller.dispatch({ type: 'rename-track', name: 'Summit Ring' })
    expect(controller.snapshot().currentTrack?.name).toBe('Summit Ring')
  })

  it('rejects incomplete race selections and opens setup for ready tracks', () => {
    const incomplete = {
      ...createStarterTrack(asTrackId('short'), 1),
      points: createStarterTrack(asTrackId('source'), 1).points.slice(0, 3),
      lighting: 'night' as const,
    }
    const { controller, trackStore, preferencesStore } = setup(incomplete)
    const ready = {
      ...createStarterTrack(asTrackId('ready'), 2),
      lighting: 'night' as const,
    }
    trackStore.tracks.set(ready.id, ready)

    controller.dispatch({
      type: 'open-track-library',
      purpose: 'race',
    })
    controller.dispatch({
      type: 'select-track-for-race',
      id: incomplete.id,
    })
    expect(controller.snapshot()).toMatchObject({
      overlay: { type: 'track-library', purpose: 'race' },
      notice: 'Add more road to complete the circuit',
    })

    controller.dispatch({ type: 'select-track-for-race', id: ready.id })
    expect(controller.snapshot()).toMatchObject({
      overlay: { type: 'race-setup' },
      currentTrack: { id: 'ready' },
      preferences: { lighting: 'night' },
    })
    expect(preferencesStore.save).toHaveBeenCalledWith({
      ...preferences,
      lighting: 'night',
    })
  })

  it('deletes scores and selects the newest remaining track', () => {
    const first = createStarterTrack(asTrackId('first'), 1)
    const { controller, trackStore, scoreStore } = setup(first)
    const newest = createStarterTrack(asTrackId('newest'), 10)
    trackStore.tracks.set(newest.id, newest)

    controller.dispatch({ type: 'delete-track', id: first.id })

    expect(scoreStore.removeTrack).toHaveBeenCalledWith(first.id)
    expect(controller.snapshot().currentTrack?.id).toBe('newest')
    expect(controller.snapshot().editor.points).toEqual(newest.points)
  })

  it('tracks editor tool, surface, grid, and camera requests', () => {
    const { controller } = setup()

    controller.dispatch({ type: 'set-editor-tool', tool: 'paint' })
    controller.dispatch({ type: 'set-editor-surface', surface: 'mixed' })
    controller.dispatch({ type: 'set-editor-terrain-mode', mode: 'water' })
    controller.dispatch({ type: 'set-editor-terrain-radius', radius: 96 })
    controller.dispatch({ type: 'toggle-editor-grid' })
    controller.dispatch({
      type: 'request-editor-camera',
      action: 'fit',
    })

    expect(controller.snapshot().editorUi).toEqual({
      tool: 'paint',
      surface: 'mixed',
      structure: 'overpass',
      terrainBrush: { mode: 'water', radius: 96 },
      grid: true,
      cameraRequest: { sequence: 1, action: 'fit' },
      selectedCrossing: null,
      selectedPoint: null,
    })
  })

  it('persists terrain changes through the editor command boundary', () => {
    const { controller, flush, trackStore } = setup()

    controller.dispatch({
      type: 'editor',
      command: {
        type: 'paint-terrain',
        cells: [{ column: 2, row: 3 }],
        kind: 'hill',
      },
    })

    expect(controller.snapshot().editor.terrain.cells).toEqual([
      { column: 2, row: 3, kind: 'hill' },
    ])
    expect(controller.snapshot().currentTrack?.terrain.cells).toEqual([
      { column: 2, row: 3, kind: 'hill' },
    ])
    flush()
    expect(trackStore.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terrain: {
          cellSize: 32,
          cells: [{ column: 2, row: 3, kind: 'hill' }],
        },
      }),
    )
  })

  it('applies undo and redo through the application command boundary', () => {
    const { controller } = setup()
    const original = controller.snapshot().editor.points[0]

    controller.dispatch({
      type: 'editor',
      command: {
        type: 'move-point',
        index: 0,
        point: { x: 999, y: 888 },
      },
    })
    expect(controller.snapshot().editor.points[0]).toMatchObject({
      x: 999,
      y: 888,
    })

    controller.dispatch({ type: 'editor', command: { type: 'undo' } })
    expect(controller.snapshot().editor.points[0]).toEqual(original)

    controller.dispatch({ type: 'editor', command: { type: 'redo' } })
    expect(controller.snapshot().editor.points[0]).toMatchObject({
      x: 999,
      y: 888,
    })
  })

  it('reports rejected expansion without mutating or scheduling persistence', () => {
    const base = createStarterTrack(asTrackId('bounded'), 1)
    const track = {
      ...base,
      terrain: normalizeTerrain({
        cells: [
          {
            column: TERRAIN_LIMITS.maximumCoordinate,
            row: 0,
            kind: 'hill',
          },
        ],
      }),
    }
    const { controller, scheduler, trackStore } = setup(track)
    const before = controller.snapshot()

    controller.dispatch({
      type: 'editor',
      command: { type: 'expand', factor: 2 },
    })

    expect(controller.snapshot().editor).toBe(before.editor)
    expect(controller.snapshot().currentTrack).toBe(before.currentTrack)
    expect(controller.snapshot().notice).toBe(
      'Expand cancelled: transformed terrain would exceed the map boundary.',
    )
    expect(scheduler.schedule).not.toHaveBeenCalled()
    expect(trackStore.save).not.toHaveBeenCalled()
  })

  it('reports domain tree rejection without creating history', () => {
    const base = createStarterTrack(asTrackId('water-tree'), 1)
    const track = {
      ...base,
      terrain: normalizeTerrain({
        cells: [{ column: 0, row: 0, kind: 'water' }],
      }),
    }
    const { controller, scheduler } = setup(track)
    const before = controller.snapshot().editor

    controller.dispatch({
      type: 'editor',
      command: { type: 'add-tree', tree: { x: 16, y: 16 } },
    })

    expect(controller.snapshot().editor).toBe(before)
    expect(controller.snapshot().notice).toBe(
      'Trees cannot be placed in water.',
    )
    expect(scheduler.schedule).not.toHaveBeenCalled()
  })
})
