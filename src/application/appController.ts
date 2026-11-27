import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import { CupFlow } from '@/application/race/cupFlow'
import { normalizeEditorSceneryChoice } from '@/application/appState'
import { courseIdentity, timeMedal, promotedTimeMedal } from '@/application/race/raceRecords'
import { collectTrackScores } from '@/application/race/trackScoreCollection'
import { OFFICIAL_COURSES } from '@/domain/track/officialCircuits'
import { DEFAULT_CUP_TRACK_IDS, recordCupResult, retryCupRace } from '@/application/race/circuitCup'
import type {
  CupStore,
  LastRace,
  LastRaceStore,
  Persistence,
  Preferences,
  PreferencesStore,
  ScoreEntry,
  ScoreStore,
  TrackStore,
} from '@/application/ports/storage'
import {
  createEditorState,
  type EditorCommand,
} from '@/domain/editor/editorState'
import { DEFAULT_TERRAIN_BRUSH_RADIUS } from '@/domain/config'
import { gridPositionsForPlayer } from '@/domain/race/startGrid'
import { raceSetupFromPreferences, withFreshStartGrid } from '@/application/race/raceSetup'
import {
  TrackLibraryService,
  type TrackMutationResult,
} from '@/application/library/trackLibraryService'
import { parseSharedTrackImport } from '@/application/library/trackImport'
import { asTrackId, type Track, type TrackId } from '@/domain/model'
import { validateTrack } from '@/domain/track/trackValidation'
import { EventBus, type Unsubscribe } from '@/application/eventBus'
import type {
  AppCommand,
  AppEvent,
  AppSnapshot,
  OverlayReturn,
} from '@/application/appState'
import type { RaceSessionPort } from '@/application/race/raceSession'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { EditorSession } from '@/application/editor/editorSession'
import { EditorExitFlow } from '@/application/editor/editorExitFlow'
import { reduceEditorUi } from '@/application/editor/editorUiReducer'
import { isSeededTrack, normalizeDisplayName } from '@/domain/track/trackCreator'
import { isSharedTrack, SHARED_TRACK_READ_ONLY_MESSAGE } from '@/domain/track/trackAccess'

export interface AppControllerDependencies {
  readonly nearby?: NearbyRace | undefined
  readonly lastRaceStore?: LastRaceStore
  readonly cupStore?: CupStore
  readonly trackStore: TrackStore
  readonly scoreStore: ScoreStore
  readonly preferencesStore: PreferencesStore
  readonly raceSession: RaceSessionPort
  readonly geometry: TrackGeometryService
  readonly now?: () => number
  readonly createTrackId?: () => TrackId
  readonly createCreatorId?: () => string
}

export class AppController {
  private readonly events = new EventBus<AppEvent>()
  private readonly now: () => number
  private readonly library: TrackLibraryService
  private state: AppSnapshot
  private readonly cupFlow: CupFlow
  private pendingCreatorId: string | undefined
  private persistencePending = false
  private destroyed = false
  private readonly editorSession: EditorSession
  private readonly editorExitFlow: EditorExitFlow
  private beforeNearbyTrack: Track | null | undefined
  private readonly unsubscribeNearby: (() => void) | undefined
  private readonly unsubscribeNearbyStart: (() => void) | undefined
  private readonly unsubscribeNearbyCountdown: (() => void) | undefined
  private unsubscribeRace: (() => void) | undefined

  constructor(private readonly dependencies: AppControllerDependencies) {
    this.now = dependencies.now ?? (() => Date.now())
    this.editorSession = new EditorSession(dependencies.trackStore, this.now)
    this.library = new TrackLibraryService({
      trackStore: dependencies.trackStore,
      scoreStore: dependencies.scoreStore,
      createId:
        dependencies.createTrackId ??
        (() =>
          asTrackId(
            `track-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          )),
      now: this.now,
    })
    const tracks = this.library.list()
    // New installations can race a built-in without persisting a legacy starter.
    const currentTrack = tracks[0] ?? OFFICIAL_COURSES[0]?.track ?? null
    this.state = {
      mode: 'home',
      raceAgainTrackName: this.resolveLastRace()?.track.name,
      cupProgress: dependencies.cupStore?.load() ?? { checkpoint: null, bestPlacement: null, lineup: DEFAULT_CUP_TRACK_IDS },
      paused: false,
      overlay: { type: 'none' },
      tracks,
      currentTrack,
      editor: createEditorState(
        currentTrack?.points ?? [],
        currentTrack?.trees ?? [],
        currentTrack?.start,
        currentTrack?.terrain,
        currentTrack ?? {},
      ),
      editorUi: {
        tool: 'draw',
        surface: 'street',
        structure: 'overpass',
        terrainBrush: {
          mode: 'raise',
          radius: DEFAULT_TERRAIN_BRUSH_RADIUS,
        },
        grid: false,
        cameraRequest: null,
        selectedCrossing: null,
        selectedPoint: null,
      },
      preferences: dependencies.preferencesStore.load(),
      scoresByTrack: this.scoresForTracks(tracks),
      notice: null,
    }
    this.cupFlow = new CupFlow({
      snapshot: () => this.state,
      update: (state) => this.update(state),
      tracks: () => this.library.list(),
      librarySnapshot: () => this.librarySnapshot(),
      goHome: () => this.dispatch({ type: 'go-home' }),
      cupStore: dependencies.cupStore,
      nearby: dependencies.nearby,
      raceSession: dependencies.raceSession,
      geometry: dependencies.geometry,
    })
    this.editorExitFlow = new EditorExitFlow({
      snapshot: () => this.state,
      update: (state) => this.update(state),
      dispatch: (command) => this.dispatch(command),
      editorSession: this.editorSession,
      library: this.library,
      trackStore: dependencies.trackStore,
      librarySnapshot: () => this.librarySnapshot(),
      creator: () => this.creator(),
      applyTrackMutation: (result) => this.applyTrackMutation(result, true),
      persist: (result, complete) => this.completePersistence(result, complete),
    })
    dependencies.nearby?.setIdentity(this.state.preferences.playerIdentity)
    dependencies.nearby?.setDisplayName(this.state.preferences.displayName)
    this.unsubscribeNearbyStart = dependencies.nearby?.onStart(({ track, car, laps, lighting, gridSlot, startsAt }) => {
      if (this.state.overlay.type !== 'nearby' &&
          !(this.state.mode === 'race' && this.state.overlay.type === 'results')) return
      if (this.beforeNearbyTrack === undefined) this.beforeNearbyTrack = this.state.currentTrack
      dependencies.raceSession.start(track, {
        car, laps, lighting, difficulty: this.state.preferences.difficulty, mode: 'nearby',
        gridPositions: gridPositionsForPlayer(gridSlot),
      }, startsAt)
      this.update({ ...this.state, mode: 'race', currentTrack: track, paused: false, cup: null, overlay: { type: 'none' }, notice: null })
    })
    this.unsubscribeNearbyCountdown = dependencies.nearby?.onCountdown((startsAt) => {
      dependencies.raceSession.scheduleNearbyStart?.(startsAt)
    })
    this.unsubscribeNearby = dependencies.nearby?.subscribe(() => {
      const status = dependencies.nearby?.snapshot()
      if (this.state.overlay.type === 'nearby' && !this.state.overlay.shareReturnTo && this.state.mode === 'race' &&
          status?.phase === 'idle' && status.error) {
        this.update({ ...this.state, mode: 'home', paused: false, overlay: { type: 'none' }, notice: status.error })
        return
      }
      if (this.state.overlay.type === 'nearby') {
        // A failed/disconnected initial lobby must not keep a stale confirmation.
        this.update(status?.phase === 'idle' && this.state.overlay.confirmLeave
          ? { ...this.state, overlay: { type: 'nearby' } }
          : { ...this.state })
        return
      }
      if (status?.phase === 'lobby' && this.state.mode === 'race' && this.beforeNearbyTrack !== undefined && this.state.overlay.type === 'results') {
        this.update({ ...this.state, overlay: { type: 'nearby' }, notice: null })
        return
      }
      if (status?.phase !== 'idle' || !status.error || this.state.mode !== 'race' ||
          this.beforeNearbyTrack === undefined) return
      if (this.state.overlay.type === 'results') {
        this.update({ ...this.state, notice: status.error })
      } else {
        this.update({ ...this.state, mode: 'home', paused: false, overlay: { type: 'none' }, notice: status.error })
      }
    })
    this.unsubscribeRace = dependencies.raceSession.subscribe((snapshot) => {
      if (!snapshot.result || this.state.mode !== 'race' || this.state.overlay.type === 'nearby') return
      if (this.state.overlay.type === 'results' ||
          (this.state.overlay.type === 'track-share' && this.state.overlay.returnTo.type === 'results')) {
        const { cup } = this.state
        const { standings } = snapshot.result
        if (cup?.rounds[cup.index]?.some((driver, index) => driver.id !== standings[index]?.id)) {
          const updated = recordCupResult(retryCupRace(cup), standings)
          const { progress, notice } = this.cupFlow.persistCup(updated)
          this.update({ ...this.state, cup: updated, cupProgress: progress, notice })
        }
        return
      }
      if (snapshot.result.mode === 'nearby' || snapshot.result.mode === 'boost-practice') {
        this.update({ ...this.state, paused: true, newTimeMedal: null, overlay: { type: 'results' } })
        return
      }
      const cup = this.state.cup ? recordCupResult(this.state.cup, snapshot.result.standings) : null
      const scores = this.scoresForTracks(this.state.tracks)
      const track = this.state.currentTrack
      const previousMedal = track ? timeMedal(track, this.state.scoresByTrack[track.id] ?? []) : null
      const earnedMedal = track ? timeMedal(track, scores[track.id] ?? []) : null
      const savedCup = cup ? this.cupFlow.persistCup(cup) : null
      this.update({
        ...this.state,
        paused: true,
        scoresByTrack: scores,
        newTimeMedal: promotedTimeMedal(previousMedal, earnedMedal),
        cupProgress: savedCup?.progress ?? this.state.cupProgress,
        cup,
        overlay: { type: 'results' },
        notice: savedCup?.notice ?? this.state.notice,
      })
    })
  }

  snapshot(): AppSnapshot {
    return this.state
  }

  subscribe(listener: (snapshot: AppSnapshot) => void): Unsubscribe {
    return this.events.subscribe((event) => listener(event.snapshot))
  }

  dispatch(command: AppCommand): void {
    // Do not allow another edit, navigation or share response to race a commit.
    if (this.persistencePending || this.destroyed) return
    if (this.editorExitFlow.intercept(command)) return
    switch (command.type) {
      case 'go-home':
        this.update({
          ...this.state,
          mode: 'home',
          raceAgainTrackName: this.resolveLastRace()?.track.name,
          currentTrack: this.state.cup ? this.cupFlow.previousTrack : this.state.currentTrack,
          cup: null,
          paused: false,
          overlay: { type: 'none' },
          notice: null,
        })
        break
      case 'race-current-track':
        if (this.state.mode === 'editor' && this.state.currentTrack) {
          // Resolve the ID now, after any Save As, not before the save dialog.
          this.selectTrackForRace(this.state.currentTrack.id)
        }
        break
      case 'open-editor':
        if (this.state.currentTrack && !isSharedTrack(this.state.currentTrack) && isSeededTrack(this.state.currentTrack)) {
          this.completePersistence(this.library.forkSeededForEdit(this.state.currentTrack, this.creator()), copy => this.applyTrackMutation(copy, true))
          break
        }
        this.update({ ...this.state, cup: null, mode: 'editor', paused: false, overlay: { type: 'none' }, notice: null })
        break
      case 'open-cup':
      case 'cup-add-track':
      case 'cup-load-curated':
      case 'cup-remove-track':
      case 'cup-move-track':
      case 'start-cup':
      case 'host-nearby-cup':
      case 'resume-cup':
      case 'next-cup-race':
        this.cupFlow.dispatch(command)
        break
      case 'set-race-lighting':
        if (this.state.overlay.type === 'race-setup') this.update({ ...this.state, raceLighting: command.lighting })
        break
      case 'race-again': {
        const saved = this.resolveLastRace()
        if (!saved) {
          this.update({ ...this.state, mode: 'home', raceAgainTrackName: undefined, overlay: { type: 'track-library', purpose: 'race' }, ...this.librarySnapshot(), notice: 'Last race is no longer available. Choose a track.' })
          break
        }
        this.dependencies.raceSession.start(saved.track, withFreshStartGrid(saved.race.setup, Math.random))
        this.rememberRace()
        this.update({
          ...this.state,
          currentTrack: saved.track,
          editor: createEditorState(saved.track.points, saved.track.trees, saved.track.start, saved.track.terrain, saved.track),
          mode: 'race',
          paused: false,
          cup: null,
          overlay: { type: 'none' },
          notice: null,
        })
        break
      }
      case 'start-race':
        // A Nearby lobby must never launch a solo race, even via stale UI commands.
        if (this.state.overlay.type === 'nearby' ||
            (this.state.overlay.type === 'track-library' && this.state.overlay.purpose === 'nearby-host')) break
        this.startRace()
        break
      case 'open-nearby':
        if (this.dependencies.nearby) this.update({ ...this.state, overlay: { type: 'nearby' }, notice: null })
        break
      case 'scan-nearby':
        if (this.state.overlay.type === 'nearby') {
          this.dependencies.nearby?.scan(this.state.preferences.car)
        }
        break
      case 'scan-nearby-track':
        if (this.state.overlay.type === 'nearby') {
          this.dependencies.nearby?.scan(this.state.preferences.car, 'share')
        }
        break
      case 'open-track-share': {
        const returnTo = this.state.overlay
        if (returnTo.type !== 'track-library' && returnTo.type !== 'editor-menu' && returnTo.type !== 'results') break
        if (isSeededTrack(command.track)) {
          this.update({ ...this.state, notice: 'Built-in tracks cannot be shared.' })
          break
        }
        this.update({ ...this.state, overlay: { type: 'track-share', track: command.track, challenge: command.challenge, returnTo }, notice: null })
        break
      }
      case 'send-nearby-track': {
        const nearby = this.dependencies.nearby
        if (!nearby || nearby.snapshot().phase !== 'idle') {
          this.update({ ...this.state, notice: 'Nearby sharing is unavailable right now.' })
          break
        }
        const overlay = this.state.overlay
        if (overlay.type !== 'track-share' || overlay.track !== command.track) break
        const track = overlay.track
        if (isSeededTrack(track)) {
          this.update({ ...this.state, notice: 'Built-in tracks cannot be shared.' })
          break
        }
        nearby.hostShare(track, overlay.challenge)
        this.update({ ...this.state, overlay: { type: 'nearby', shareReturnTo: overlay.returnTo }, notice: null })
        break
      }
      case 'save-nearby-track': {
        const nearby = this.dependencies.nearby
        const track = nearby?.pendingSharedTrack()
        if (!track) break
        this.completePersistence(this.library.importShared(track), saved => {
          const currentShare = nearby?.pendingSharedTrack() === track
          if (!saved.ok) {
            if (currentShare) nearby?.recordShareSaveFailure(this.dependencies.trackStore.failureReason?.() ?? 'storage_rejected')
            this.update({ ...this.state, notice: saved.message })
            return
          }
          if (currentShare) nearby?.respondToShare(true)
          this.update({ ...this.state, ...this.librarySnapshot(), notice: `Saved "${saved.track.name}" to your library.` })
        })
        break
      }
      case 'decline-nearby-track':
        this.dependencies.nearby?.respondToShare(false)
        break
      case 'nearby-race-again':
        if (this.state.mode === 'race' && this.state.overlay.type === 'results') {
          this.dependencies.nearby?.start()
        }
        break
      case 'nearby-select-next-track':
        if (this.state.mode === 'race' && this.state.overlay.type === 'results' &&
            this.dependencies.nearby?.snapshot().canRematch) {
          this.update({ ...this.state, overlay: { type: 'track-library', purpose: 'nearby' }, ...this.librarySnapshot() })
        }
        break
      case 'nearby-scene-ready':
        if (this.state.mode === 'race' && this.beforeNearbyTrack !== undefined) {
          this.dependencies.nearby?.sceneReady()
        }
        break
      case 'leave-nearby':
        if (this.state.mode === 'race' && this.beforeNearbyTrack !== undefined) {
          this.dispatch({ type: 'go-home' })
        } else if (this.state.overlay.type === 'nearby' && this.state.overlay.confirmLeave) {
          this.update({ ...this.state, overlay: { type: 'none' }, notice: null })
        }
        break
      case 'pause-race':
        if (this.state.mode === 'race' && this.state.overlay.type !== 'results' &&
            !(this.state.overlay.type === 'track-share' && this.state.overlay.returnTo.type === 'results') &&
            !(this.state.overlay.type === 'nearby' && this.state.overlay.shareReturnTo?.type === 'results')) {
          if (this.beforeNearbyTrack === undefined) this.dependencies.raceSession.setPaused(true)
          this.update({
            ...this.state,
            paused: true,
            overlay: { type: 'pause' },
          })
        }
        break
      case 'resume-race':
        if (this.state.mode === 'race' && this.state.overlay.type !== 'results') {
          this.dependencies.raceSession.setPaused(false)
          this.update({
            ...this.state,
            paused: false,
            overlay: { type: 'none' },
          })
        }
        break
      case 'race-best-ghost': {
        const { track, setup } = this.dependencies.raceSession.snapshot()
        if (this.state.mode === 'race' && track && setup && setup.mode !== 'nearby' &&
            this.dependencies.raceSession.ghostTime?.(track, setup) != null) {
          this.dependencies.raceSession.start(track, { ...setup, mode: 'ghost' })
          if (!this.state.cup) this.rememberRace()
          this.update({ ...this.state, paused: false, overlay: { type: 'none' }, notice: null })
        }
        break
      }
      case 'restart-race':
        if (this.state.mode === 'race' && this.beforeNearbyTrack === undefined) {
          const cup = this.state.cup ? retryCupRace(this.state.cup) : null
          const savedCup = cup ? this.cupFlow.persistCup(cup) : null
          this.dependencies.raceSession.restart()
          this.update({
            ...this.state,
            paused: false,
            cup,
            cupProgress: savedCup?.progress ?? this.state.cupProgress,
            overlay: { type: 'none' },
            notice: savedCup?.notice ?? null,
          })
        }
        break
      case 'select-track':
        this.selectTrack(command.id)
        break
      case 'open-track-library': {
        if (command.purpose === 'nearby-host' &&
            (this.state.overlay.type !== 'nearby' || this.dependencies.nearby?.snapshot().phase !== 'idle')) break
        const library = this.librarySnapshot()
        this.update({
          ...this.state,
          ...(this.state.mode === 'race' ? { mode: 'home' as const, paused: false, cup: null } : {}),
          overlay: {
            type: 'track-library',
            purpose: command.purpose,
          },
          ...library,
        })
        break
      }
      case 'close-overlay':
        this.closeOverlay()
        break
      case 'open-track-name':
        if (command.purpose === 'rename' && isSharedTrack(this.state.currentTrack)) {
          this.update({ ...this.state, notice: SHARED_TRACK_READ_ONLY_MESSAGE })
          break
        }
        this.update({
          ...this.state,
          overlay: {
            type: 'track-name',
            purpose: command.purpose,
            returnTo: this.overlayReturn(),
          },
          notice: null,
        })
        break
      case 'open-player-name':
        if (this.state.mode === 'home' && !this.state.preferences.displayName) {
          this.update({ ...this.state, overlay: { type: 'player-name' }, notice: null })
        }
        break
      case 'set-player-name':
        this.setPlayerName(command.name)
        break
      case 'open-options':
        this.update({
          ...this.state,
          overlay: {
            type: 'options',
            returnTo: command.returnTo,
            ...(command.tab ? { tab: command.tab } : {}),
          },
          notice: null,
        })
        break
      case 'open-editor-menu':
        if (this.state.mode === 'editor') {
          this.update({
            ...this.state,
            overlay: { type: 'editor-menu' },
            notice: null,
          })
        }
        break
      case 'save-current-track':
        this.saveCurrentTrack()
        break
      case 'save-as-track':
        this.editorExitFlow.saveAs(command.name)
        break
      case 'resolve-editor-exit':
        this.editorExitFlow.resolve(command.choice)
        break
      case 'select-editor-scenery':
      case 'set-editor-scenery':
      case 'set-editor-tool':
      case 'select-editor-crossing':
      case 'select-editor-point':
      case 'set-editor-surface':
      case 'set-editor-structure':
      case 'set-editor-terrain-mode':
      case 'set-editor-terrain-radius':
      case 'toggle-editor-grid':
      case 'request-editor-camera':
        this.update({
          ...this.state,
          editorUi: reduceEditorUi(this.state.editorUi, command, this.state.editor.environmentId),
        })
        break
      case 'create-track':
        this.completePersistence(this.library.create(command.name, this.creator()), result => this.applyTrackMutation(result, true))
        break
      case 'rename-track':
        if (this.state.currentTrack) {
          const mutation = this.state.mode === 'editor'
            ? this.library.renameDraft(this.state.currentTrack, command.name)
            : this.library.rename(this.state.currentTrack.id, command.name)
          this.completePersistence(mutation, result => {
            if (!result.ok) {
              this.update({ ...this.state, notice: result.message })
            } else {
              const track = this.state.mode === 'editor'
                ? { ...result.track, updatedAt: this.now() }
                : result.track
              this.update({
                ...this.state,
                currentTrack: track,
                tracks: this.library.list().map((item) => item.id === track.id ? track : item),
                overlay: { type: 'none' },
                notice: null,
              })
            }
          })
        }
        break
      case 'toggle-track-favorite': {
        if (this.state.overlay.type !== 'track-library') break
        const track = this.library.select(command.id) ??
          OFFICIAL_COURSES.find(({ track: candidate }) => candidate.id === command.id)?.track
        if (!track) break
        const previous = this.state.preferences.favoriteTrackIds ?? []
        const favoriteTrackIds = previous.includes(track.id)
          ? previous.filter((id) => id !== track.id)
          : [...previous, track.id]
        if (favoriteTrackIds.length > 256) {
          this.update({ ...this.state, notice: 'You can favorite up to 256 tracks.' })
          break
        }
        const preferences = { ...this.state.preferences, favoriteTrackIds }
        if (!this.dependencies.preferencesStore.save(preferences)) {
          this.update({ ...this.state, notice: 'Could not save track favorites on this device.' })
          break
        }
        this.update({ ...this.state, preferences, notice: null })
        break
      }
      case 'delete-track':
        this.deleteTrack(command.id)
        break
      case 'import-track':
        this.importTrack(command.content)
        break
      case 'select-track-for-edit':
        this.selectTrackForEdit(command.id)
        break
      case 'select-track-for-race':
        this.selectTrackForRace(command.id)
        break
      case 'editor':
        this.edit(command.command)
        break
      case 'report-editor-rejection':
        this.update({
          ...this.state,
          notice: command.rejection.message,
        })
        break
      case 'set-preferences':
        this.setPreferences(command.preferences)
        break
    }
  }

  destroy(): void {
    this.destroyed = true
    this.editorSession.discardPendingSave()
    this.events.clear()
    this.unsubscribeRace?.()
    this.unsubscribeRace = undefined
    this.unsubscribeNearby?.()
    this.unsubscribeNearbyStart?.()
    this.unsubscribeNearbyCountdown?.()
    this.dependencies.nearby?.destroy()
    this.dependencies.raceSession.destroy()
  }

  private rememberRace(): void {
    if (!this.dependencies.lastRaceStore) return
    const { track, setup } = this.dependencies.raceSession.snapshot()
    if (!track || !setup) return
    this.dependencies.lastRaceStore?.save({ trackId: track.id, course: courseIdentity(track), setup: { ...setup, mode: setup.mode ?? 'normal', lighting: setup.lighting ?? track.lighting } })
  }

  private resolveLastRace(): { race: LastRace; track: Track } | null {
    const race = this.dependencies.lastRaceStore?.load()
    if (!race) return null
    const track = this.dependencies.trackStore.find(race.trackId) ?? OFFICIAL_COURSES.find((entry) => entry.track.id === race.trackId)?.track
    if (!track || courseIdentity(track) !== race.course || !validateTrack(track, this.dependencies.geometry.get(track).path.totalLength).ready) return null
    if (race.setup.mode === 'ghost' && this.dependencies.raceSession.ghostTime?.(track, race.setup) == null) return null
    return { race, track }
  }

  private startRace(): void {
    const track = this.state.currentTrack
    if (!track) {
      this.update({
        ...this.state,
        mode: 'editor',
        notice: 'Create a track before starting a race',
      })
      return
    }
    const validation = validateTrack(
      track,
      this.dependencies.geometry.get(track).path.totalLength,
    )
    if (validation.ready) {
      this.dependencies.raceSession.start(track, raceSetupFromPreferences(
        track,
        this.state.preferences,
        this.state.overlay.type === 'race-setup'
          ? this.state.raceLighting ?? track.lighting
          : track.lighting,
        Math.random,
      ))
      this.rememberRace()
    }
    this.update(
      validation.ready
        ? {
            ...this.state,
            mode: 'race',
            paused: false,
            overlay: { type: 'none' },
            notice: null,
          }
        : {
            ...this.state,
            mode: 'editor',
            paused: false,
            notice: validation.message,
          },
    )
  }

  private selectTrack(id: TrackId): void {
    const track = this.library.select(id)
    if (!track) return
    this.editorSession.discardPendingSave()
    this.update({
      ...this.state,
      currentTrack: track,
      editor: createEditorState(
        track.points,
        track.trees,
        track.start,
        track.terrain,
        track,
      ),
      notice: null,
    })
  }

  private selectTrackForEdit(id: TrackId): void {
    const source = this.library.select(id)
    if (!source) return
    if (!isSharedTrack(source) && isSeededTrack(source)) {
      this.completePersistence(this.library.forkSeededForEdit(source, this.creator()), result => this.applyTrackMutation(result, true))
      return
    }
    const track = source
    this.editorSession.discardPendingSave()
    const library = this.librarySnapshot()
    this.update({
      ...this.state,
      mode: 'editor',
      paused: false,
      overlay: { type: 'none' },
      currentTrack: track,
      ...library,
      editor: createEditorState(
        track.points,
        track.trees,
        track.start,
        track.terrain,
        track,
      ),
      notice: null,
    })
  }

  private selectTrackForRace(id: TrackId): void {
    const track = OFFICIAL_COURSES.find((entry) => entry.track.id === id)?.track ?? this.library.select(id)
    if (!track) return
    const validation = validateTrack(
      track,
      this.dependencies.geometry.get(track).path.totalLength,
    )
    if (!validation.ready) {
      this.update({
        ...this.state,
        ...this.librarySnapshot(),
        ...(this.state.mode === 'editor' ? { overlay: { type: 'none' as const } } : {}),
        notice: validation.message,
      })
      return
    }
    if (this.state.overlay.type === 'track-library' && this.state.overlay.purpose === 'cup') {
      const returnTo = this.state.overlay.cupReturnTo
      const cupOverlay = { type: 'cup' as const, ...(returnTo ? { returnTo } : {}) }
      const lineup = this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS
      if (lineup.length >= 12) {
        this.update({ ...this.state, overlay: cupOverlay, notice: 'Cup is limited to 12 races.' })
      } else {
        this.cupFlow.setCupLineup([...lineup, track.id])
        this.update({ ...this.state, overlay: cupOverlay })
      }
      return
    }
    if (this.state.overlay.type === 'track-library' && this.state.overlay.purpose === 'nearby') {
      if (this.dependencies.nearby?.selectNextTrack(track)) {
        this.update({ ...this.state, overlay: { type: 'results' }, notice: null })
        this.dependencies.nearby.start()
      }
      return
    }
    if (this.state.overlay.type === 'track-library' && this.state.overlay.purpose === 'nearby-host') {
      const nearby = this.dependencies.nearby
      if (!nearby || nearby.snapshot().phase !== 'idle') {
        this.update({ ...this.state, notice: 'Nearby hosting is unavailable. Try again.' })
        return
      }
      this.editorSession.discardPendingSave()
      this.update({
        ...this.state,
        currentTrack: track,
        editor: createEditorState(track.points, track.trees, track.start, track.terrain, track),
        raceLighting: track.lighting,
        overlay: { type: 'nearby' },
        notice: null,
      })
      nearby.host({
        track, car: this.state.preferences.car, lighting: track.lighting,
        laps: track.routeKind === 'point-to-point' ? 1 : this.state.preferences.raceLaps ?? 2,
      })
      return
    }
    this.editorSession.discardPendingSave()
    const library = this.librarySnapshot()
    this.update({
      ...this.state,
      overlay: { type: 'race-setup' },
      currentTrack: track,
      ...library,
      editor: createEditorState(
        track.points,
        track.trees,
        track.start,
        track.terrain,
        track,
      ),
      raceLighting: track.lighting,
      notice: null,
    })
  }

  private applyTrackMutation(
    result: TrackMutationResult,
    enterEditor: boolean,
  ): void {
    if (!result.ok) {
      this.update({ ...this.state, notice: result.message })
      return
    }
    this.editorSession.discardPendingSave()
    const library = this.librarySnapshot()
    this.update({
      ...this.state,
      mode: enterEditor ? 'editor' : this.state.mode,
      cup: enterEditor ? null : this.state.cup ?? null,
      paused: false,
      overlay: { type: 'none' },
      currentTrack: result.track,
      ...library,
      editor: createEditorState(
        result.track.points,
        result.track.trees,
        result.track.start,
        result.track.terrain,
        result.track,
      ),
      notice: null,
    })
  }

  private importTrack(content: string): void {
    const overlay = this.state.overlay
    const imported = parseSharedTrackImport(content).then((parsed): Persistence<TrackMutationResult> => {
      if (!parsed.ok) return parsed
      if (this.destroyed) return { ok: false, message: 'Track import was canceled.' }
      const track = {
        ...parsed.track,
        ...(parsed.signedSource ? { signedSource: parsed.signedSource } : {}),
        ...(parsed.signedChallengeSource ? { signedChallengeSource: parsed.signedChallengeSource } : {}),
      }
      return this.library.importShared(track)
    })
    this.completePersistence(imported, result => {
      if (result.ok && result.track.creatorChallenge && this.state.overlay === overlay &&
          overlay.type === 'track-library' && overlay.purpose === 'race') {
        this.selectTrackForRace(result.track.id)
        return
      }
      this.applyTrackMutation(result, true)
    })
  }

  private deleteTrack(id: TrackId): void {
    const deletingCurrent = this.state.currentTrack?.id === id
    const previousNotice = this.state.notice
    this.completePersistence(this.library.delete(id), deleted => {
      if (!deleted) {
        this.update({ ...this.state, notice: 'Track could not be deleted.' })
        return
      }
      if (this.state.currentTrack?.id === id) {
        this.editorSession.discardPendingSave()
      }
      const tracks = this.library.list()
      const currentTrack =
        this.state.currentTrack?.id === id
          ? (tracks[0] ?? null)
          : this.state.currentTrack
      this.update({
        ...this.state,
        tracks,
        scoresByTrack: this.scoresForTracks(tracks),
        currentTrack,
        editor:
          this.state.currentTrack?.id === id
            ? createEditorState(
                currentTrack?.points ?? [],
                currentTrack?.trees ?? [],
                currentTrack?.start,
                currentTrack?.terrain,
                currentTrack ?? {},
              )
            : this.state.editor,
        notice: deletingCurrent ? null : previousNotice,
      })
    })
  }

  private closeOverlay(): void {
    const overlay = this.state.overlay
    if (overlay.type === 'editor-exit') {
      this.editorExitFlow.resolve('cancel')
      return
    }
    if (overlay.type === 'track-share') {
      this.update({ ...this.state, overlay: overlay.returnTo, notice: null })
      return
    }
    if (overlay.type === 'nearby' && overlay.shareReturnTo) {
      this.update({ ...this.state, overlay: overlay.shareReturnTo, notice: null })
      if (this.state.mode === 'race') this.dependencies.nearby?.close()
      return
    }
    if (overlay.type === 'nearby') {
      // All dismiss paths (including platform Back/Escape) share this policy.
      // Keep the overlay type unchanged so update() does not close the room.
      if (overlay.confirmLeave) {
        this.update({ ...this.state, overlay: { type: 'nearby' } })
        return
      }
      const status = this.dependencies.nearby?.snapshot()
      const connectedRace = status?.purpose === 'race' &&
        (status.phase === 'hosting' || status.phase === 'waiting' ||
          status.phase === 'preparing' || status.phase === 'lobby' || status.phase === 'staging')
      if (connectedRace || (this.state.mode === 'race' && this.beforeNearbyTrack !== undefined)) {
        this.update({ ...this.state, overlay: { type: 'nearby', confirmLeave: true } })
        return
      }
    }
    if (overlay.type === 'cup-final' || overlay.type === 'results') {
      this.dispatch({ type: 'go-home' })
      return
    }
    if (overlay.type === 'cup') {
      this.update({ ...this.state, overlay: overlay.returnTo === 'nearby' ? { type: 'nearby' } : { type: 'none' }, notice: null })
      return
    }
    if (overlay.type === 'player-name' && !this.state.preferences.displayName) return
    if (overlay.type === 'track-name') {
      this.update({
        ...this.state,
        overlay: overlay.returnTo,
        notice: null,
      })
      return
    }
    if (overlay.type === 'pause' && this.beforeNearbyTrack !== undefined) {
      this.dispatch({ type: 'resume-race' })
      return
    }
    if (overlay.type === 'track-library' && overlay.purpose === 'cup') {
      this.update({ ...this.state, overlay: { type: 'cup',
        ...(overlay.cupReturnTo ? { returnTo: overlay.cupReturnTo } : {}) }, notice: null })
      return
    }
    if (overlay.type === 'track-library' && overlay.purpose === 'nearby') {
      this.update({ ...this.state, overlay: { type: 'results' }, notice: null })
      return
    }
    if (overlay.type === 'track-library' && overlay.purpose === 'nearby-host') {
      this.update({ ...this.state, overlay: { type: 'nearby' }, notice: null })
      return
    }
    if (overlay.type === 'race-setup') {
      this.update({
        ...this.state,
        // A quick race started from the editor returns there, not to the picker.
        overlay: this.state.mode === 'editor'
          ? { type: 'none' }
          : { type: 'track-library', purpose: 'race' },
        notice: null,
      })
      return
    }
    if (overlay.type === 'options') {
      this.update({
        ...this.state,
        overlay:
          overlay.returnTo === 'race-setup'
            ? { type: 'race-setup' }
            : overlay.returnTo === 'race'
              ? { type: 'pause' }
              : overlay.returnTo === 'editor'
                ? { type: 'editor-menu' }
                : { type: 'none' },
        notice: null,
      })
      return
    }
    this.update({
      ...this.state,
      overlay: { type: 'none' },
      notice: null,
    })
  }

  private overlayReturn(): OverlayReturn {
    const overlay = this.state.overlay
    if (overlay.type === 'track-library') return overlay
    if (overlay.type === 'editor-menu' || overlay.type === 'editor-exit') return overlay
    return { type: 'none' }
  }

  private creator(): { readonly id: string; readonly name: string } | undefined {
    const { creatorId, displayName } = this.state.preferences
    return creatorId && displayName ? { id: creatorId, name: displayName } : undefined
  }

  private setPlayerName(value: string): void {
    const name = normalizeDisplayName(value)
    if (!name) {
      this.update({ ...this.state, notice: 'Choose a name of 2–24 letters, numbers or simple punctuation.' })
      return
    }
    const id = this.state.preferences.creatorId ?? this.pendingCreatorId ??
      (this.dependencies.createCreatorId ?? (() => crypto.randomUUID()))()
    this.pendingCreatorId = id
    this.completePersistence(this.library.recredit({ id, name }), result => {
      if (!result.ok) {
        this.update({ ...this.state, notice: 'Could not update track credits. Try again.' })
        return
      }
      const preferences = { ...this.state.preferences, displayName: name, creatorId: id }
      if (!this.dependencies.preferencesStore.save(preferences)) {
        this.update({ ...this.state, notice: 'Could not save your player name. Try again.' })
        return
      }
      this.dependencies.nearby?.setDisplayName(name)
      const tracks = this.library.list()
      const storedTrack = tracks.find((track) => track.id === this.state.currentTrack?.id)
      const currentTrack = storedTrack && this.state.currentTrack && this.state.mode === 'editor' && this.editorExitFlow.isDirty()
        ? { ...this.state.currentTrack, ...(storedTrack.creator ? { creator: storedTrack.creator } : {}) }
        : storedTrack ?? this.state.currentTrack
      this.update({
        ...this.state,
        preferences,
        tracks,
        currentTrack,
        overlay: this.state.overlay.type === 'player-name' ? { type: 'none' } : this.state.overlay,
        notice: result.count > 0 ? `Player name saved · ${result.count} track credit${result.count === 1 ? '' : 's'} updated.` : 'Player name saved.',
      })
    })
  }

  private setPreferences(
    preferences: Preferences,
  ): void {
    if (!this.dependencies.preferencesStore.save(preferences)) {
      this.update({ ...this.state, notice: 'Preferences could not be saved on this device.' })
      return
    }
    this.dependencies.nearby?.setIdentity(preferences.playerIdentity)
    this.dependencies.nearby?.setDisplayName(preferences.displayName)
    this.update({ ...this.state, preferences })
  }

  private saveCurrentTrack(): void {
    const track = this.state.currentTrack
    if (!track) return
    if (isSharedTrack(track)) {
      if (this.state.mode === 'editor') this.dispatch({ type: 'open-track-name', purpose: 'save-as' })
      return
    }
    this.completePersistence(this.editorSession.save(track), saved => {
      this.update({
        ...this.state,
        ...(saved ? { ...this.librarySnapshot(), overlay: { type: 'none' } as const } : {}),
        notice: saved ? 'Track saved.' : 'Save unavailable.',
      })
    })
  }

  private completePersistence<T>(result: Persistence<T>, complete: (value: T) => void): void {
    if (!(result instanceof Promise)) {
      complete(result)
      return
    }
    this.persistencePending = true
    this.update({ ...this.state, notice: 'Saving track library…' })
    void result.then(value => {
      this.persistencePending = false
      if (!this.destroyed) complete(value)
    }, (error: unknown) => {
      this.persistencePending = false
      console.error('Track library transaction failed unexpectedly.', error)
      if (!this.destroyed) this.update({ ...this.state, notice: 'Track library operation failed. Try again.' })
    })
  }

  private scoresForTracks(
    tracks: readonly Track[],
  ): Readonly<Record<string, readonly ScoreEntry[]>> {
    return collectTrackScores(
      tracks,
      OFFICIAL_COURSES.map(({ track }) => track),
      this.dependencies.scoreStore,
    )
  }

  private librarySnapshot(): Pick<
    AppSnapshot,
    'tracks' | 'scoresByTrack'
  > {
    const tracks = this.library.list()
    return {
      tracks,
      scoresByTrack: this.scoresForTracks(tracks),
    }
  }

  private edit(command: EditorCommand): void {
    const currentTrack = this.state.currentTrack
    if (!currentTrack) return
    const result = this.editorSession.apply(this.state.editor, currentTrack, command)
    if ('rejection' in result) {
      this.update({ ...this.state, notice: result.rejection })
      return
    }
    const { editor, track } = result
    if (editor === this.state.editor) return
    const selection = this.state.editorUi.selectedScenery
    const preservesScenerySelection = command.type === 'transform-scenery' || command.type === 'move-tree' || command.type === 'move-scenery-prop'
    const editorUi = selection && !preservesScenerySelection && (editor.trees !== this.state.editor.trees || editor.scenery !== this.state.editor.scenery)
      ? { ...this.state.editorUi, selectedScenery: null } : this.state.editorUi
    if (!track) {
      this.update({ ...this.state, editor, editorUi })
      return
    }
    this.update({
      ...this.state,
      editorUi,
      mode: 'editor',
      currentTrack: track,
      tracks: this.state.tracks.map((entry) => entry.id === track.id ? track : entry),
      editor,
      notice: null,
    })
  }

  private update(state: AppSnapshot): void {
    let editorUi = state.editorUi
    const readOnly = state.mode === 'editor' && isSharedTrack(state.currentTrack)
    const leavingPreview = this.state.mode === 'editor' && isSharedTrack(this.state.currentTrack) && !readOnly
    if (readOnly && editorUi.tool !== 'pan') {
      editorUi = { ...editorUi, tool: 'pan' }
    } else if ((leavingPreview && editorUi.tool === 'pan') ||
        (editorUi.tool === 'start' && state.editor.routeKind === 'point-to-point')) {
      editorUi = { ...editorUi, tool: 'draw' }
    }
    if (editorUi.selectedScenery && (state.mode !== 'editor' || editorUi.tool !== 'tree' || readOnly ||
      state.currentTrack?.id !== this.state.currentTrack?.id || state.editor.environmentId !== this.state.editor.environmentId)) {
      editorUi = { ...editorUi, selectedScenery: null }
    }
    if (editorUi.sceneryChoice !== undefined) {
      editorUi = {
        ...editorUi,
        sceneryChoice: normalizeEditorSceneryChoice(editorUi.sceneryChoice, state.editor.environmentId),
      }
    }
    let normalized = editorUi === state.editorUi ? state : { ...state, editorUi }
    const leavingRace = this.state.mode === 'race' && normalized.mode !== 'race'
    const leavingLobby = this.state.overlay.type === 'nearby' && normalized.overlay.type !== 'nearby' && normalized.mode !== 'race'
    if (leavingRace && this.beforeNearbyTrack !== undefined) {
      normalized = { ...normalized, currentTrack: this.beforeNearbyTrack }
      this.beforeNearbyTrack = undefined
    }
    this.state = normalized
    if (leavingRace) this.dependencies.raceSession.stop()
    if (leavingLobby || leavingRace) this.dependencies.nearby?.close()
    this.events.publish({ type: 'state-changed', snapshot: normalized })
  }
}
