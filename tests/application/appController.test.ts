import { courseIdentity } from '@/application/race/raceRecords'
import { BrowserCupRepository } from '@/infrastructure/storage/cupRepository'
import { DEFAULT_CUP_TRACK_IDS, createCup, recordCupResult, advanceCup, CUP_CIRCUITS } from '@/application/race/circuitCup'
import { describe, expect, it, vi } from 'vitest'
import type {
  CupStore,
  Preferences,
  PreferencesStore,
  ScoreStore,
  TrackStore,
} from '@/application/ports/storage'
import { AppController } from '@/application/appController'
import { asTrackId, type Track, type TrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { decodeTrack } from '@/domain/track/trackCodec'
import { RaceSession, type RaceSessionPort } from '@/application/race/raceSession'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { normalizeTerrain } from '@/domain/terrain/terrainField'
import { TERRAIN_LIMITS } from '@/domain/config'
import { NearbyRace, type NearbyTransport } from '@/application/multiplayer/nearbyRace'

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
  audioEnabled: true,
  hapticsEnabled: true,
  dynamicZoomEnabled: true,
}

function setup(track = createStarterTrack(asTrackId('starter'), 1), realRace = false, cupStore?: CupStore, nearby?: NearbyRace) {
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
  const raceSession: RaceSessionPort = {
    start: vi.fn(),
    restart: vi.fn(),
    stop: vi.fn(),
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
    ...(cupStore ? { cupStore } : {}),
    ...(nearby ? { nearby } : {}),
    trackStore,
    preferencesStore,
    scoreStore,
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
    raceSession: session,
  }
}

describe('AppController', () => {
  it('does not apply unsaved preferences to UI state when durable storage rejects the commit', () => {
    const { controller, preferencesStore } = setup()
    vi.mocked(preferencesStore.save).mockReturnValueOnce(false)
    controller.dispatch({ type: 'set-preferences', preferences: { ...preferences, car: 'red' } })
    expect(controller.snapshot().preferences.car).toBe('blue')
    expect(controller.snapshot().notice).toContain('could not be saved')
    controller.destroy()
  })

  it('toggles personal favorites without changing track edit timestamps or geometry', () => {
    const track = createStarterTrack(asTrackId('favorite-track'), 7)
    const { controller, trackStore, preferencesStore } = setup(track)
    controller.dispatch({ type: 'open-track-library', purpose: 'edit' })
    controller.dispatch({ type: 'toggle-track-favorite', id: track.id })
    expect(controller.snapshot().preferences.favoriteTrackIds).toEqual([track.id])
    expect(preferencesStore.save).toHaveBeenCalledWith(expect.objectContaining({ favoriteTrackIds: [track.id] }))
    expect(trackStore.find(track.id)).toBe(track)
    controller.dispatch({ type: 'toggle-track-favorite', id: track.id })
    expect(controller.snapshot().preferences.favoriteTrackIds).toEqual([])
    vi.mocked(preferencesStore.save).mockReturnValueOnce(false)
    controller.dispatch({ type: 'toggle-track-favorite', id: track.id })
    expect(controller.snapshot().preferences.favoriteTrackIds).toEqual([])
    expect(controller.snapshot().notice).toContain('Could not save')
    controller.dispatch({ type: 'toggle-track-favorite', id: asTrackId('unknown') })
    expect(controller.snapshot().preferences.favoriteTrackIds).toEqual([])
    controller.destroy()
  })

  it('hosts only after selecting a race-ready track, never starts a solo race', async () => {
    const advertise = vi.fn(async (_room: string) => undefined)
    const transport: NearbyTransport = {
      subscribe: () => () => undefined, host: advertise,
      scan: async () => undefined, connect: async () => undefined,
      respond: async () => undefined, lock: async () => undefined,
      send: async () => undefined, stop: async () => undefined,
    }
    const nearby = new NearbyRace(transport, () => true)
    const { controller, raceSession } = setup(undefined, false, undefined, nearby)
    try {
      controller.dispatch({ type: 'open-nearby' })
      controller.dispatch({ type: 'open-track-library', purpose: 'nearby-host' })
      expect(controller.snapshot().overlay).toEqual({ type: 'track-library', purpose: 'nearby-host' })
      controller.dispatch({ type: 'start-race' })
      expect(raceSession.start).not.toHaveBeenCalled()
      controller.dispatch({ type: 'close-overlay' })
      expect(controller.snapshot().overlay.type).toBe('nearby')

      controller.dispatch({ type: 'open-track-library', purpose: 'nearby-host' })
      controller.dispatch({ type: 'select-track-for-race', id: asTrackId('starter') })
      expect(controller.snapshot()).toMatchObject({ mode: 'home', overlay: { type: 'nearby' } })
      await vi.waitFor(() => expect(advertise).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(nearby.snapshot().phase).toBe('hosting'))
      expect(nearby.snapshot().track).toBe('Starter Circuit')
      expect(nearby.snapshot().canStart).toBe(false)
      nearby.start()
      controller.dispatch({ type: 'start-race' })
      expect(raceSession.start).not.toHaveBeenCalled()
    } finally {
      controller.destroy()
    }
  })

  it('rejects a non-race-ready circuit before opening a Nearby room', () => {
    const advertise = vi.fn(async (_room: string) => undefined)
    const transport: NearbyTransport = {
      subscribe: () => () => undefined, host: advertise,
      scan: async () => undefined, connect: async () => undefined,
      respond: async () => undefined, lock: async () => undefined,
      send: async () => undefined, stop: async () => undefined,
    }
    const nearby = new NearbyRace(transport, () => true)
    const incomplete = {
      ...createStarterTrack(asTrackId('incomplete-host'), 1),
      points: createStarterTrack(asTrackId('shape'), 1).points.slice(0, 3),
    }
    const { controller, raceSession } = setup(incomplete, false, undefined, nearby)
    try {
      controller.dispatch({ type: 'open-nearby' })
      controller.dispatch({ type: 'open-track-library', purpose: 'nearby-host' })
      controller.dispatch({ type: 'select-track-for-race', id: incomplete.id })
      expect(controller.snapshot().overlay).toEqual({ type: 'track-library', purpose: 'nearby-host' })
      expect(advertise).not.toHaveBeenCalled()
      expect(raceSession.start).not.toHaveBeenCalled()
    } finally {
      controller.destroy()
    }
  })

  it('asks for a player name and migrates tracks while preserving results and stable creator identity', () => {
    const seeded = createStarterTrack(asTrackId('local-legacy'), 1)
    const { controller, trackStore, preferencesStore } = setup({ ...seeded, creator: { id: 'local-user-123', name: 'Player' } })
    const starter = controller.snapshot().currentTrack
    const id = starter?.id
    const previousRevision = starter?.raceRevision
    controller.dispatch({ type: 'open-player-name' })
    expect(controller.snapshot().overlay.type).toBe('player-name')
    controller.dispatch({ type: 'close-overlay' })
    expect(controller.snapshot().overlay.type).toBe('player-name')
    controller.dispatch({ type: 'set-preferences', preferences: { ...preferences, creatorId: 'local-user-123' } })
    controller.dispatch({ type: 'set-player-name', name: ' A ' })
    expect(controller.snapshot().overlay.type).toBe('player-name')
    controller.dispatch({ type: 'set-player-name', name: 'Julien QC' })
    expect(controller.snapshot().overlay.type).toBe('none')
    expect(controller.snapshot().preferences.displayName).toBe('Julien QC')
    expect(controller.snapshot().currentTrack?.creator).toEqual({ id: 'local-user-123', name: 'Julien QC' })
    expect(trackStore.find(id!)?.raceRevision).toBe(previousRevision)
    controller.dispatch({ type: 'open-options', returnTo: 'home' })
    controller.dispatch({ type: 'set-player-name', name: 'Racer QC' })
    expect(controller.snapshot().overlay.type).toBe('options')
    expect(trackStore.find(id!)?.creator).toEqual({ id: 'local-user-123', name: 'Racer QC' })
    expect(preferencesStore.save).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Racer QC', creatorId: 'local-user-123' }))
  })

  it('saves the new route kind and launches a one-run Time Trial', () => {
    const starter = createStarterTrack(asTrackId('new-route'), 1)
    const track: Track = {
      ...starter,
      points: [{ x: 0, y: 0, surface: 'street' }, { x: 1_200, y: 0, surface: 'street' }],
    }
    const { controller, trackStore, raceSession } = setup(track)
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'set-editor-tool', tool: 'start' })
    controller.dispatch({ type: 'editor', command: { type: 'set-route-kind', routeKind: 'point-to-point' } })
    expect(controller.snapshot().editorUi.tool).toBe('draw')
    expect(controller.snapshot().currentTrack?.raceRevision).toBeGreaterThan(track.updatedAt)
    controller.dispatch({ type: 'select-track-for-race', id: track.id })
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'save' })
    expect(trackStore.find(track.id)?.routeKind).toBe('point-to-point')
    expect(controller.snapshot().overlay.type).toBe('race-setup')
    controller.dispatch({
      type: 'set-preferences',
      preferences: { ...preferences, raceMode: 'time-trial', raceLaps: 3 },
    })
    controller.dispatch({ type: 'start-race' })
    expect(raceSession.start).toHaveBeenCalledWith(
      expect.objectContaining({ routeKind: 'point-to-point' }),
      expect.objectContaining({ mode: 'time-trial', laps: 1 }),
    )
  })

  it('captures setup lighting without changing the track, and retains it on retry', () => {
    const { controller, raceSession, trackStore } = setup(undefined, true)
    const before = JSON.stringify(trackStore.find(asTrackId('starter')))
    controller.dispatch({ type: 'select-track-for-race', id: asTrackId('starter') })
    controller.dispatch({ type: 'set-race-lighting', lighting: 'night' })
    controller.dispatch({ type: 'open-options', returnTo: 'race-setup' })
    controller.dispatch({ type: 'close-overlay' })
    expect(controller.snapshot().raceLighting).toBe('night')
    controller.dispatch({ type: 'start-race' })
    expect(raceSession.snapshot().setup?.lighting).toBe('night')
    expect(JSON.stringify(trackStore.find(asTrackId('starter')))).toBe(before)
    controller.dispatch({ type: 'restart-race' })
    expect(raceSession.snapshot().setup?.lighting).toBe('night')
    controller.dispatch({ type: 'select-track-for-race', id: asTrackId('starter') })
    expect(controller.snapshot().raceLighting).toBe('day')
  })

  it('starts and finishes even when saving the last race fails', () => {
    const track = createStarterTrack(asTrackId('lost-write'), 1)
    const trackStore = new TrackMemory()
    trackStore.tracks.set(track.id, track)
    const scoreStore: ScoreStore = { forTrack: () => [], record: () => true, removeTrack: () => true }
    const session = new RaceSession({ scoreStore, random: { next: () => 0.5 }, feedback: { unlock: vi.fn(), setEnabled: vi.fn(), handle: vi.fn(), silenceContinuous: vi.fn(), destroy: vi.fn() }, step: (state) => ({ state: { ...state, phase: 'finished', vehicles: state.vehicles.map((vehicle) => vehicle.player ? { ...vehicle, finishedAt: 12.5 } : vehicle) }, events: [{ type: 'race-finished', reason: 'finished' }] }) })
    const controller = new AppController({ trackStore, scoreStore, lastRaceStore: { load: () => null, save: () => false }, preferencesStore: { load: () => preferences, save: () => true }, raceSession: session, geometry: new TrackGeometryService() })
    controller.dispatch({ type: 'start-race' })
    session.advance(3.7, { steering: 0, throttle: 1, braking: false })
    session.advance(0.02, { steering: 0, throttle: 1, braking: false })
    expect(controller.snapshot().overlay.type).toBe('results')
    expect(session.snapshot().result?.playerTime).toBe(12.5)
  })

  it('rechecks a remembered track when Race Again is tapped', () => {
    const track = createStarterTrack(asTrackId('remembered'), 1)
    const trackStore = new TrackMemory()
    trackStore.tracks.set(track.id, track)
    const scoreStore: ScoreStore = { forTrack: () => [], record: () => true, removeTrack: () => true }
    const session = new RaceSession({ scoreStore, random: { next: () => 0.5 }, feedback: { unlock: vi.fn(), setEnabled: vi.fn(), handle: vi.fn(), silenceContinuous: vi.fn(), destroy: vi.fn() } })
    const lastRaceStore = { load: () => ({ trackId: track.id, course: courseIdentity(track), setup: { car: 'blue' as const, difficulty: 'normal' as const, laps: 2, handling: 'arcade' as const, mode: 'normal' as const, lighting: 'night' as const } }), save: () => true }
    const controller = new AppController({ trackStore, scoreStore, lastRaceStore, preferencesStore: { load: () => preferences, save: () => true }, raceSession: session, geometry: new TrackGeometryService() })
    expect(controller.snapshot().raceAgainTrackName).toBe(track.name)
    trackStore.remove(track.id)
    controller.dispatch({ type: 'race-again' })
    expect(controller.snapshot()).toMatchObject({ mode: 'home', overlay: { type: 'track-library', purpose: 'race' }, notice: expect.stringContaining('no longer available') })
  })

  it('resumes unfinished and scored checkpoints and restores final standings without a race', () => {
    const values = new Map<string, string>()
    const store = new BrowserCupRepository({ get: (key) => values.get(key) ?? null, set: (key, value) => { values.set(key, value); return true }, remove: (key) => values.delete(key) })
    const first = setup(undefined, false, store)
    first.controller.dispatch({ type: 'open-cup' })
    first.controller.dispatch({ type: 'start-cup' })
    first.controller.dispatch({ type: 'go-home' })
    const resumed = setup(undefined, false, store)
    resumed.controller.dispatch({ type: 'resume-cup' })
    expect(resumed.raceSession.start).toHaveBeenCalledWith(CUP_CIRCUITS[0]?.track, expect.objectContaining({ car: 'blue', difficulty: 'normal' }))
    const standings = [{ id: 'player', car: 'blue' as const, player: true, place: 1, finishTime: 10, wrecked: false, lap: 1 }]
    let cup = recordCupResult(createCup(), standings)
    store.save({ checkpoint: cup, bestPlacement: null })
    const afterScore = setup(undefined, false, store)
    afterScore.controller.dispatch({ type: 'resume-cup' })
    expect(afterScore.raceSession.start).toHaveBeenCalledWith(CUP_CIRCUITS[1]?.track, expect.anything())
    for (let i = 1; i < CUP_CIRCUITS.length; i++) cup = recordCupResult(advanceCup(cup), standings)
    store.save({ checkpoint: cup, bestPlacement: null })
    const final = setup(undefined, false, store)
    final.controller.dispatch({ type: 'resume-cup' })
    expect(final.controller.snapshot().overlay.type).toBe('cup-final')
    expect(final.raceSession.start).not.toHaveBeenCalled()
    final.controller.dispatch({ type: 'next-cup-race' })
    expect(store.load()).toEqual({ checkpoint: null, bestPlacement: 1, lineup: DEFAULT_CUP_TRACK_IDS })
  })

  it('shows an official race record on Home without adding the circuit to saved tracks', () => {
    const { controller, raceSession, scoreStore } = setup(undefined, true)
    let scores: ReturnType<ScoreStore['forTrack']> = []
    vi.mocked(scoreStore.forTrack).mockImplementation((id) => id === 'official-city-sprint' ? scores : [])
    vi.mocked(scoreStore.record).mockImplementation((_id, score) => { scores = [score]; return true })
    controller.dispatch({ type: 'select-track-for-race', id: asTrackId('official-city-sprint') })
    controller.dispatch({ type: 'start-race' })
    const input = { steering: 0, throttle: 1, braking: false }
    raceSession.advance(3.7, input)
    raceSession.advance(0.02, input)
    controller.dispatch({ type: 'go-home' })
    expect(controller.snapshot().scoresByTrack['official-city-sprint']?.[0]?.time).toBe(12.5)
    expect(controller.snapshot().tracks.map((track) => track.id)).toEqual(['starter'])
  })

  it('runs the cup from Home, retries without duplicate points, and restores the saved track', () => {
    const { controller, raceSession, trackStore } = setup(undefined, true)
    const input = { steering: 0, throttle: 1, braking: false }
    const finish = () => { raceSession.advance(3.7, input); raceSession.advance(0.02, input) }
    controller.dispatch({ type: 'open-cup' })
    controller.dispatch({ type: 'start-cup' })
    expect(controller.snapshot()).toMatchObject({ mode: 'race', cup: { index: 0 }, currentTrack: { id: 'official-city-sprint' } })
    expect(raceSession.snapshot().setup).toMatchObject({ mode: 'normal', handling: 'arcade', laps: 1 })
    finish()
    const first = controller.snapshot().cup
    expect(first?.rounds).toHaveLength(1)
    controller.dispatch({ type: 'restart-race' })
    expect(controller.snapshot().cup?.rounds).toHaveLength(0)
    finish()
    expect(controller.snapshot().cup?.rounds).toEqual(first?.rounds)
    for (const id of ['official-desert-sweep', 'official-toy-box']) {
      controller.dispatch({ type: 'next-cup-race' })
      expect(controller.snapshot().currentTrack?.id).toBe(id)
      finish()
    }
    expect(controller.snapshot().cup?.rounds).toHaveLength(3)
    controller.dispatch({ type: 'next-cup-race' })
    expect(controller.snapshot()).toMatchObject({ mode: 'home', currentTrack: { id: 'starter' }, cup: null })
    expect(trackStore.list().map((track) => track.id)).toEqual(['starter'])
  })


  it('opens the Updates category directly and returns to Home after closing', () => {
    const { controller } = setup()
    controller.dispatch({ type: 'open-options', returnTo: 'home', tab: 'updates' })
    expect(controller.snapshot().overlay).toEqual({ type: 'options', returnTo: 'home', tab: 'updates' })
    controller.dispatch({ type: 'close-overlay' })
    expect(controller.snapshot().overlay).toEqual({ type: 'none' })
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

    expect(raceSession.stop).toHaveBeenCalledOnce()
    expect(controller.snapshot().mode).toBe('home')
  })

  it('returns from finished results to the existing editor and silences the race', () => {
    const { controller, raceSession, trackStore } = setup(undefined, true)
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'start-race' })
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'save' })
    const input = { steering: 0, throttle: 1, braking: false }
    raceSession.advance(3.7, input)
    raceSession.advance(0.02, input)
    expect(controller.snapshot()).toMatchObject({ mode: 'race', paused: true, overlay: { type: 'results' } })

    controller.dispatch({ type: 'open-editor' })

    expect(controller.snapshot()).toMatchObject({ mode: 'editor', paused: false, overlay: { type: 'none' }, currentTrack: { id: 'starter' } })
    expect(raceSession.snapshot().state).toBeNull()
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
    raceSession.advance(0.25, input)
    expect(raceSession.snapshot().state).toMatchObject({ phase: 'countdown', elapsed: 0 })
    raceSession.advance(3.7, input)
    raceSession.advance(0.02, input)
    expect(controller.snapshot().overlay.type).toBe('results')
    controller.dispatch({ type: 'go-home' })
    expect(controller.snapshot()).toMatchObject({ mode: 'home', paused: false, overlay: { type: 'none' } })
    expect(raceSession.snapshot().state).toBeNull()
  })

  it('cancels the rival finish window as soon as the player opens the track picker', () => {
    const { controller, raceSession } = setup(undefined, true)
    const input = { steering: 0, throttle: 1, braking: false }
    controller.dispatch({ type: 'start-race' })
    raceSession.advance(3.7, input)
    raceSession.advance(0.02, input)
    expect(raceSession.snapshot().result?.rivalsFinishing).toBe(true)

    controller.dispatch({ type: 'open-track-library', purpose: 'race' })
    expect(controller.snapshot()).toMatchObject({ mode: 'home', overlay: { type: 'track-library' } })
    raceSession.advance(0.25, input)
    expect(raceSession.snapshot()).toMatchObject({ state: null, result: null })
  })

  it('races the best ghost using the active session setup', () => {
    const { controller, raceSession } = setup()
    controller.dispatch({ type: 'start-race' })
    const activeTrack = createStarterTrack(asTrackId('active'), 2)
    const activeSetup = { car: 'red' as const, difficulty: 'hard' as const, laps: 3, handling: 'simulation' as const, mode: 'normal' as const }
    vi.mocked(raceSession.snapshot).mockReturnValue({ track: activeTrack, setup: activeSetup } as ReturnType<RaceSessionPort['snapshot']>)
    raceSession.ghostTime = vi.fn(() => 100)
    controller.dispatch({ type: 'race-best-ghost' })
    expect(raceSession.start).toHaveBeenLastCalledWith(activeTrack, { ...activeSetup, mode: 'ghost' })
    expect(controller.snapshot().overlay.type).toBe('none')
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


  it('edits only a draft until Save, and never autosaves on destroy', () => {
    const { controller, trackStore } = setup()
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    expect(trackStore.save).not.toHaveBeenCalled()
    controller.dispatch({ type: 'go-home' })
    expect(controller.snapshot().overlay.type).toBe('editor-exit')
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'cancel' })
    expect(controller.snapshot().mode).toBe('editor')
    controller.destroy()
    expect(trackStore.find(asTrackId('starter'))?.trees).not.toContainEqual({ x: 4, y: 5 })
  })

  it.each(['before navigating', 'in exit confirmation'] as const)(
    'does not reopen exit confirmation after saving normalized road data %s',
    (when) => {
      const { controller, trackStore } = setup()
      trackStore.save.mockImplementation((track) => {
        const normalized = decodeTrack(track, 500)
        if (!normalized) return false
        trackStore.tracks.set(normalized.id, normalized)
        return true
      })
      controller.dispatch({ type: 'open-editor' })
      controller.dispatch({ type: 'editor', command: {
        type: 'add-point', point: { id: 'additional', x: 250, y: 100, surface: 'street' },
      } })
      if (when === 'before navigating') {
        controller.dispatch({ type: 'save-current-track' })
        expect(controller.snapshot().notice).toBe('Track saved.')
      }
      controller.dispatch({ type: 'go-home' })
      if (when === 'in exit confirmation') {
        expect(controller.snapshot().overlay.type).toBe('editor-exit')
        controller.dispatch({ type: 'resolve-editor-exit', choice: 'save' })
      }
      expect(controller.snapshot()).toMatchObject({ mode: 'home', overlay: { type: 'none' } })
      expect(trackStore.find(asTrackId('starter'))?.points.at(-1)).toHaveProperty('structure', 'surface')
    },
  )

  it.each(['go-home', 'start-race'] as const)('Save commits and resumes %s', (type) => {
    const { controller, trackStore, raceSession } = setup()
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type })
    expect(controller.snapshot()).toMatchObject({ mode: 'editor', overlay: { type: 'editor-exit' } })
    expect(raceSession.start).not.toHaveBeenCalled()
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'save' })
    expect(trackStore.find(asTrackId('starter'))?.trees).toContainEqual({ x: 4, y: 5 })
    expect(controller.snapshot().mode).toBe(type === 'go-home' ? 'home' : 'race')
  })

  it.each(['edit', 'race'] as const)('Discard reverts draft before opening %s picker', (purpose) => {
    const { controller, trackStore } = setup()
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'open-track-library', purpose })
    expect(controller.snapshot().overlay.type).toBe('editor-exit')
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'discard' })
    expect(controller.snapshot().overlay).toEqual({ type: 'track-library', purpose })
    expect(controller.snapshot().currentTrack?.trees).not.toContainEqual({ x: 4, y: 5 })
    expect(trackStore.find(asTrackId('starter'))?.trees).not.toContainEqual({ x: 4, y: 5 })
  })

  it.each(['select-track', 'select-track-for-edit', 'select-track-for-race'] as const)(
    'guards %s without accidentally saving prior edits', (type) => {
      const { controller, trackStore } = setup()
      const other = createStarterTrack(asTrackId('other'), 2)
      trackStore.tracks.set(other.id, other)
      controller.dispatch({ type: 'open-editor' })
      controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
      controller.dispatch({ type, id: other.id })
      expect(controller.snapshot().overlay.type).toBe('editor-exit')
      controller.dispatch({ type: 'resolve-editor-exit', choice: 'discard' })
      expect(controller.snapshot().currentTrack?.id).toBe(other.id)
      expect(trackStore.find(asTrackId('starter'))?.trees).not.toContainEqual({ x: 4, y: 5 })
    },
  )

  it('Save As creates a distinct track, validates names and preserves the original', () => {
    const { controller, trackStore } = setup()
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'go-home' })
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'save-as' })
    controller.dispatch({ type: 'save-as-track', name: 'Starter Circuit' })
    expect(controller.snapshot().notice).toBe('That track name is already in use.')
    controller.dispatch({ type: 'close-overlay' })
    expect(controller.snapshot().overlay.type).toBe('editor-exit')
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'save-as' })
    controller.dispatch({ type: 'save-as-track', name: 'New Circuit' })
    expect(controller.snapshot()).toMatchObject({ mode: 'home', currentTrack: { id: 'created', name: 'New Circuit' } })
    expect(trackStore.find(asTrackId('created'))?.trees).toContainEqual({ x: 4, y: 5 })
    expect(trackStore.find(asTrackId('starter'))?.trees).not.toContainEqual({ x: 4, y: 5 })
  })

  it('Save As resumes a pending race using the new track without overwriting the source', () => {
    const { controller, trackStore, raceSession } = setup()
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'start-race' })
    expect(controller.snapshot().overlay.type).toBe('editor-exit')
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'save-as' })
    controller.dispatch({ type: 'save-as-track', name: 'Alternate Circuit' })
    expect(controller.snapshot()).toMatchObject({
      mode: 'race',
      currentTrack: { id: 'created', name: 'Alternate Circuit' },
    })
    expect(trackStore.find(asTrackId('created'))?.trees).toContainEqual({ x: 4, y: 5 })
    expect(trackStore.find(asTrackId('starter'))?.trees).not.toContainEqual({ x: 4, y: 5 })
    expect(raceSession.start).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'created' }),
      expect.anything(),
    )
  })

  it('does not leave on save failure and allows retry without draft loss', () => {
    const { controller, trackStore } = setup()
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'go-home' })
    trackStore.save.mockReturnValueOnce(false)
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'save' })
    expect(controller.snapshot()).toMatchObject({ mode: 'editor', overlay: { type: 'editor-exit' }, notice: 'Save unavailable.' })
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'save' })
    expect(controller.snapshot().mode).toBe('home')
    expect(trackStore.find(asTrackId('starter'))?.trees).toContainEqual({ x: 4, y: 5 })
  })

  it('renaming stays in the draft and is also reverted by Discard', () => {
    const { controller, trackStore } = setup()
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'rename-track', name: 'Renamed' })
    expect(controller.snapshot().currentTrack).toMatchObject({ name: 'Renamed', trees: expect.arrayContaining([{ x: 4, y: 5 }]) })
    expect(trackStore.find(asTrackId('starter'))?.name).toBe('Starter Circuit')
    controller.dispatch({ type: 'go-home' })
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'discard' })
    expect(controller.snapshot().currentTrack?.name).toBe('Starter Circuit')
    expect(controller.snapshot().currentTrack?.trees).not.toContainEqual({ x: 4, y: 5 })
  })

  it('undoing the whole edit returns to clean without prompting', () => {
    const { controller, trackStore } = setup()
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'editor', command: { type: 'undo' } })
    controller.dispatch({ type: 'go-home' })
    expect(controller.snapshot()).toMatchObject({ mode: 'home', overlay: { type: 'none' } })
    expect(trackStore.save).not.toHaveBeenCalled()
  })

  it('does not resurrect a deleted unsaved track', () => {
    const { controller, trackStore } = setup()
    controller.dispatch({ type: 'open-editor' })
    controller.dispatch({ type: 'editor', command: { type: 'add-tree', tree: { x: 4, y: 5 } } })
    controller.dispatch({ type: 'delete-track', id: asTrackId('starter') })
    controller.destroy()
    expect(trackStore.find(asTrackId('starter'))).toBeUndefined()
  })

  it('persists preference changes through the injected repository', () => {
    const { controller, preferencesStore } = setup()

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
    const { controller, trackStore } = setup(incomplete)
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
      raceLighting: 'night',
    })


    controller.dispatch({ type: 'open-options', returnTo: 'race-setup' })
    controller.dispatch({ type: 'set-preferences', preferences: {
      ...controller.snapshot().preferences, raceLaps: 3, handling: 'simulation',
    } })
    controller.dispatch({ type: 'close-overlay' })
    expect(controller.snapshot()).toMatchObject({
      overlay: { type: 'race-setup' }, currentTrack: { id: 'ready' },
      preferences: { raceLaps: 3, handling: 'simulation' },
    })
    controller.dispatch({ type: 'close-overlay' })
    expect(controller.snapshot().overlay).toEqual({ type: 'track-library', purpose: 'race' })
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
    const { controller, trackStore } = setup()

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
    controller.dispatch({ type: 'save-current-track' })
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
    const { controller, trackStore } = setup(track)
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
    const { controller } = setup(track)
    const before = controller.snapshot().editor

    controller.dispatch({
      type: 'editor',
      command: { type: 'add-tree', tree: { x: 16, y: 16 } },
    })

    expect(controller.snapshot().editor).toBe(before)
    expect(controller.snapshot().notice).toBe(
      'Trees cannot be placed in water.',
    )
  })
})

describe('scenery persistence', () => {
  it('saves scenery changes as race-affecting edits and preserves road revision increments', () => {
    const original = createStarterTrack(asTrackId('first'), 1)
    const { controller, trackStore } = setup(original)
    const other = createStarterTrack(asTrackId('second'), 2)
    trackStore.tracks.set(other.id, other)
    controller.dispatch({ type: 'editor', command: { type: 'set-environment', environmentId: 'cityscape' } })
    controller.dispatch({ type: 'editor', command: { type: 'add-scenery-prop', prop: { kind: 'city-house', x: 100, y: 100 } } })
    expect(controller.snapshot().currentTrack?.raceRevision).toBeGreaterThan(original.raceRevision ?? original.updatedAt)
    controller.dispatch({ type: 'select-track-for-edit', id: other.id })
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'save' })
    expect(trackStore.find(original.id)?.scenery).toEqual([{ kind: 'city-house', x: 100, y: 100 }])
    controller.dispatch({ type: 'select-track-for-edit', id: original.id })
    expect(controller.snapshot().editor.environmentId).toBe('cityscape')
    controller.dispatch({ type: 'editor', command: { type: 'add-point', point: { x: 0, y: 0, surface: 'street' } } })
    const firstRevision = controller.snapshot().currentTrack?.raceRevision ?? 0
    controller.dispatch({ type: 'editor', command: { type: 'add-point', point: { x: 1, y: 1, surface: 'street' } } })
    expect(controller.snapshot().currentTrack?.raceRevision).toBe(firstRevision + 1)
  })
})

describe('gesture race revisions', () => {
  it.each(['cancel-gesture', 'undo'] as const)('restores the revision and saves the starting course after %s', (finish) => {
    const track = createStarterTrack(asTrackId('gesture'), 1)
    const { controller, trackStore } = setup(track)
    controller.dispatch({ type: 'editor', command: { type: 'set-environment', environmentId: 'desert' } })
    const start = controller.snapshot().currentTrack
    if (!start || start.raceRevision === undefined) throw new Error('Missing starting race revision')
    controller.dispatch({ type: 'editor', command: { type: 'begin-gesture' } })
    controller.dispatch({ type: 'editor', command: { type: 'move-point', index: 0, point: { x: 123, y: 456 } } })
    expect(controller.snapshot().currentTrack?.raceRevision).toBeGreaterThan(start.raceRevision)
    controller.dispatch({ type: 'editor', command: { type: finish } })
    expect(controller.snapshot().currentTrack?.raceRevision).toBe(start.raceRevision)
    controller.dispatch({ type: 'save-current-track' })
    expect(trackStore.find(track.id)).toMatchObject({ points: start.points, environmentId: 'desert', raceRevision: start.raceRevision })
  })
})

describe('gesture revision isolation', () => {
  it('keeps a committed revision and does not carry a gesture revision to another track', () => {
    const track = createStarterTrack(asTrackId('gesture-first'), 1)
    const { controller, trackStore } = setup(track)
    const second = createStarterTrack(asTrackId('gesture-second'), 7)
    trackStore.tracks.set(second.id, second)
    controller.dispatch({ type: 'editor', command: { type: 'begin-gesture' } })
    controller.dispatch({ type: 'editor', command: { type: 'move-point', index: 0, point: { x: 10, y: 20 } } })
    controller.dispatch({ type: 'editor', command: { type: 'end-gesture' } })
    const committed = controller.snapshot().currentTrack!.raceRevision!
    expect(committed).toBeGreaterThan(track.raceRevision ?? track.updatedAt)
    controller.dispatch({ type: 'select-track-for-edit', id: second.id })
    controller.dispatch({ type: 'resolve-editor-exit', choice: 'save' })
    controller.dispatch({ type: 'editor', command: { type: 'begin-gesture' } })
    controller.dispatch({ type: 'editor', command: { type: 'move-point', index: 0, point: { x: 10, y: 20 } } })
    controller.dispatch({ type: 'editor', command: { type: 'cancel-gesture' } })
    controller.dispatch({ type: 'save-current-track' })
    expect(trackStore.find(second.id)?.raceRevision).toBe(second.raceRevision ?? second.updatedAt)
    expect(trackStore.find(track.id)?.raceRevision).toBe(committed)
  })
})

it('discards an editor draft whose persisted record disappeared without trapping navigation', () => {
  const { controller, trackStore } = setup()
  controller.dispatch({ type: 'open-editor' })
  const draft = controller.snapshot().currentTrack
  if (!draft) throw new Error('Expected active editor track')
  trackStore.tracks.delete(draft.id)

  controller.dispatch({ type: 'go-home' })
  expect(controller.snapshot().overlay.type).toBe('editor-exit')
  controller.dispatch({ type: 'resolve-editor-exit', choice: 'discard' })
  expect(controller.snapshot().mode).toBe('home')
  expect(controller.snapshot().currentTrack).toBeNull()
  expect(controller.snapshot().notice).toBeNull()
  controller.destroy()
})
