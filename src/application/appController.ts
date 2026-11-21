import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import { normalizeEditorSceneryChoice } from '@/application/appState'
import { courseIdentity, timeMedal } from '@/application/race/raceRecords'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { DEFAULT_CUP_TRACK_IDS, cupTrackIds, cupRoundCount, validCupLineup, cupStandings, createCup, recordCupResult, retryCupRace, advanceCup, cupGridPositions, type CircuitCup, type CupProgress } from '@/application/race/circuitCup'
import type {
  CupStore,
  LastRace,
  LastRaceStore,
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
import { parseTrackImport } from '@/application/library/trackImport'
import { asTrackId, normalizeRouteKind, type Track, type TrackId } from '@/domain/model'
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
import { EditorSession, type Scheduler } from '@/application/editor/editorSession'
import { reduceEditorUi } from '@/application/editor/editorUiReducer'
import { isSeededTrack, normalizeDisplayName } from '@/domain/track/trackCreator'

export type { Scheduler } from '@/application/editor/editorSession'

export interface AppControllerDependencies {
  readonly nearby?: NearbyRace | undefined
  readonly lastRaceStore?: LastRaceStore
  readonly cupStore?: CupStore
  readonly trackStore: TrackStore
  readonly scoreStore: ScoreStore
  readonly preferencesStore: PreferencesStore
  readonly scheduler: Scheduler
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
  private preCupTrack: Track | null = null
  private pendingCreatorId: string | undefined
  private readonly editorSession: EditorSession
  private beforeNearbyTrack: Track | null | undefined
  private readonly unsubscribeNearby: (() => void) | undefined
  private readonly unsubscribeNearbyStart: (() => void) | undefined
  private readonly unsubscribeNearbyCountdown: (() => void) | undefined
  private unsubscribeRace: (() => void) | undefined

  constructor(private readonly dependencies: AppControllerDependencies) {
    this.now = dependencies.now ?? (() => Date.now())
    this.editorSession = new EditorSession(dependencies.trackStore, dependencies.scheduler, this.now)
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
    const currentTrack = tracks[0] ?? null
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
    dependencies.nearby?.setIdentity(this.state.preferences.playerIdentity)
    dependencies.nearby?.setDisplayName(this.state.preferences.displayName)
    this.unsubscribeNearbyStart = dependencies.nearby?.onStart(({ track, car, laps, lighting, gridSlot, startsAt }) => {
      if (this.state.overlay.type !== 'nearby' &&
          !(this.state.mode === 'race' && this.state.overlay.type === 'results')) return
      if (this.beforeNearbyTrack === undefined) this.beforeNearbyTrack = this.state.currentTrack
      dependencies.raceSession.start(track, {
        car, laps, lighting, difficulty: this.state.preferences.difficulty, handling: 'arcade', mode: 'nearby',
        gridPositions: gridPositionsForPlayer(gridSlot),
      }, startsAt)
      this.update({ ...this.state, mode: 'race', currentTrack: track, paused: false, cup: null, overlay: { type: 'none' }, notice: null })
    })
    this.unsubscribeNearbyCountdown = dependencies.nearby?.onCountdown((startsAt) => {
      dependencies.raceSession.scheduleNearbyStart?.(startsAt)
    })
    this.unsubscribeNearby = dependencies.nearby?.subscribe(() => {
      if (this.state.overlay.type === 'nearby') {
        this.update({ ...this.state })
        return
      }
      const status = dependencies.nearby?.snapshot()
      if (status?.phase !== 'idle' || !status.error || this.state.mode !== 'race' ||
          this.beforeNearbyTrack === undefined) return
      if (this.state.overlay.type === 'results') {
        this.update({ ...this.state, notice: status.error })
      } else {
        this.update({ ...this.state, mode: 'home', paused: false, overlay: { type: 'none' }, notice: status.error })
      }
    })
    this.unsubscribeRace = dependencies.raceSession.subscribe((snapshot) => {
      if (!snapshot.result || this.state.mode !== 'race') return
      if (this.state.overlay.type === 'results') {
        const { cup } = this.state
        const { standings } = snapshot.result
        if (cup?.rounds[cup.index]?.some((driver, index) => driver.id !== standings[index]?.id)) {
          const updated = recordCupResult(retryCupRace(cup), standings)
          const { progress, notice } = this.persistCup(updated)
          this.update({ ...this.state, cup: updated, cupProgress: progress, notice })
        }
        return
      }
      if (snapshot.result.mode === 'nearby') {
        this.update({ ...this.state, paused: true, newTimeMedal: null, overlay: { type: 'results' } })
        return
      }
      const cup = this.state.cup ? recordCupResult(this.state.cup, snapshot.result.standings) : null
      const scores = this.scoresForTracks(this.state.tracks)
      const track = this.state.currentTrack
      const previousMedal = track ? timeMedal(track, this.state.scoresByTrack[track.id] ?? []) : null
      const earnedMedal = track ? timeMedal(track, scores[track.id] ?? []) : null
      const rank = (medal: typeof earnedMedal) => medal === 'gold' ? 3 : medal === 'silver' ? 2 : medal === 'bronze' ? 1 : 0
      const savedCup = cup ? this.persistCup(cup) : null
      this.update({
        ...this.state,
        paused: true,
        scoresByTrack: scores,
        newTimeMedal: rank(earnedMedal) > rank(previousMedal) ? earnedMedal : null,
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
    switch (command.type) {
      case 'go-home':
        if (!this.flushPendingEditorSave()) break
        this.update({
          ...this.state,
          mode: 'home',
          raceAgainTrackName: this.resolveLastRace()?.track.name,
          currentTrack: this.state.cup ? this.preCupTrack : this.state.currentTrack,
          cup: null,
          paused: false,
          overlay: { type: 'none' },
          notice: null,
        })
        break
      case 'open-editor':
        if (this.state.currentTrack && isSeededTrack(this.state.currentTrack)) {
          const copy = this.library.forkSeededForEdit(this.state.currentTrack, this.creator())
          if (!copy.ok) { this.update({ ...this.state, notice: copy.message }); break }
          this.applyTrackMutation(copy, true)
          break
        }
        this.update({ ...this.state, cup: null, mode: 'editor', paused: false, overlay: { type: 'none' }, notice: null })
        break
      case 'open-cup':
        if (this.state.mode === 'home' &&
            (this.state.overlay.type === 'none' ||
              (this.state.overlay.type === 'nearby' && this.dependencies.nearby?.snapshot().phase === 'idle'))) {
          this.update({ ...this.state, overlay: { type: 'cup',
            ...(this.state.overlay.type === 'nearby' ? { returnTo: 'nearby' as const } : {}) }, notice: null })
        }
        break
      case 'cup-add-track':
        if (this.state.overlay.type === 'cup' &&
            (this.state.cupProgress?.lineup?.length ?? DEFAULT_CUP_TRACK_IDS.length) < 12) {
          this.update({ ...this.state, overlay: { type: 'track-library', purpose: 'cup' }, ...this.librarySnapshot(), notice: null })
        }
        break
      case 'cup-remove-track': {
        if (this.state.overlay.type !== 'cup') break
        const lineup = [...(this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS)]
        if (!Number.isInteger(command.index) || command.index < 0 || command.index >= lineup.length) break
        lineup.splice(command.index, 1)
        this.setCupLineup(lineup)
        break
      }
      case 'cup-move-track': {
        if (this.state.overlay.type !== 'cup') break
        const lineup = [...(this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS)]
        const next = command.index + command.direction
        if (!Number.isInteger(command.index) || next < 0 || next >= lineup.length) break
        const [trackId] = lineup.splice(command.index, 1)
        if (!trackId) break
        lineup.splice(next, 0, trackId)
        this.setCupLineup(lineup)
        break
      }
      case 'start-cup': {
        if (this.state.overlay.type !== 'cup' || !this.flushPendingEditorSave()) break
        const ids = this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS
        if (!this.validateCupTracks(ids)) break
        this.preCupTrack = this.state.currentTrack
        this.launchCupRace(createCup(this.state.preferences.car, this.state.preferences.difficulty, ids))
        break
      }
      case 'host-nearby-cup': {
        const nearby = this.dependencies.nearby
        if (this.state.overlay.type !== 'cup' || !nearby || nearby.snapshot().phase !== 'idle' ||
            !this.flushPendingEditorSave()) break
        const ids = this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS
        if (!this.validateCupTracks(ids)) break
        const tracks = ids.map(id => this.cupTrack(id)).filter((track): track is Track => !!track)
        nearby.hostCup(tracks, this.state.preferences.car, this.state.preferences.raceLaps ?? 2)
        this.update({ ...this.state, overlay: { type: 'nearby' }, notice: null })
        break
      }
      case 'resume-cup': {
        const cup = this.state.cupProgress?.checkpoint
        if (!cup) break
        this.preCupTrack = this.state.currentTrack
        if (!this.validateCupTracks(cupTrackIds(cup))) break
        if (cup.rounds.length > cup.index && cup.index === cupRoundCount(cup) - 1) {
          this.update({ ...this.state, cup, overlay: { type: 'cup-final' } })
        } else {
          this.launchCupRace(cup.rounds.length > cup.index ? advanceCup(cup) : cup)
        }
        break
      }
      case 'next-cup-race':
        if (this.state.cup && (this.state.overlay.type === 'results' || this.state.overlay.type === 'cup-final')) {
          if (this.state.cup.index === cupRoundCount(this.state.cup) - 1) {
            const placement = cupStandings(this.state.cup).findIndex((driver) => driver.id === 'player') + 1
            const previous = this.state.cupProgress?.bestPlacement ?? null
            const progress = { checkpoint: null, bestPlacement: placement > 0 ? Math.min(previous ?? placement, placement) : previous, lineup: this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS }
            const notice = this.saveCupProgress(progress)
            this.dispatch({ type: 'go-home' })
            this.update({ ...this.state, cupProgress: progress, notice })
          } else {
            this.launchCupRace(advanceCup(this.state.cup))
          }
        }
        break
      case 'set-race-lighting':
        if (this.state.overlay.type === 'race-setup') this.update({ ...this.state, raceLighting: command.lighting })
        break
      case 'race-again': {
        if (!this.flushPendingEditorSave()) break
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
      case 'toggle-nearby-customize':
        if (this.state.overlay.type === 'nearby' && this.dependencies.nearby?.snapshot().phase === 'idle') {
          this.update({ ...this.state, overlay: { type: 'nearby', customize: !this.state.overlay.customize } })
        }
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
      case 'send-nearby-track': {
        const nearby = this.dependencies.nearby
        if (!nearby) break
        if (nearby.snapshot().phase !== 'idle' || !this.flushPendingEditorSave()) break
        const track = this.state.tracks.find(entry => entry.id === command.track.id) ?? command.track
        if (isSeededTrack(track)) {
          this.update({ ...this.state, notice: 'Built-in tracks cannot be shared.' })
          break
        }
        nearby.hostShare(track)
        this.update({ ...this.state, overlay: { type: 'nearby' }, notice: null })
        break
      }
      case 'save-nearby-track': {
        const nearby = this.dependencies.nearby
        const track = nearby?.pendingSharedTrack()
        if (!track || !this.flushPendingEditorSave()) break
        const saved = this.library.importShared(track)
        if (!saved.ok) {
          this.update({ ...this.state, notice: saved.message })
          break
        }
        nearby?.respondToShare(true)
        this.update({ ...this.state, ...this.librarySnapshot(), notice: `Saved "${saved.track.name}" to your library.` })
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
        }
        break
      case 'pause-race':
        if (this.state.mode === 'race' && this.state.overlay.type !== 'results') {
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
          const savedCup = cup ? this.persistCup(cup) : null
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
        // Preserve existing picker behavior on save failure; only hosting requires a clean save.
        if (!this.flushPendingEditorSave() && command.purpose === 'nearby-host') break
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
        if (!this.flushPendingEditorSave()) break
        this.applyTrackMutation(this.library.create(command.name, this.creator()), true)
        break
      case 'rename-track':
        if (!this.flushPendingEditorSave()) break
        if (this.state.currentTrack) {
          this.applyTrackMutation(
            this.library.rename(
              this.state.currentTrack.id,
              command.name,
            ),
            false,
          )
        }
        break
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
    this.flushPendingEditorSave()
    this.events.clear()
    this.unsubscribeRace?.()
    this.unsubscribeRace = undefined
    this.unsubscribeNearby?.()
    this.unsubscribeNearbyStart?.()
    this.unsubscribeNearbyCountdown?.()
    this.dependencies.nearby?.destroy()
    this.dependencies.raceSession.destroy()
  }

  private saveCupProgress(progress: CupProgress): string | null {
    return this.dependencies.cupStore?.save(progress) === false
      ? 'Cup progress could not be saved on this device.'
      : null
  }

  private persistCup(checkpoint: CircuitCup): { progress: CupProgress; notice: string | null } {
    const progress = { checkpoint, bestPlacement: this.state.cupProgress?.bestPlacement ?? null,
      lineup: this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS }
    return { progress, notice: this.saveCupProgress(progress) }
  }

  private setCupLineup(lineup: readonly string[]): void {
    const progress: CupProgress = { ...this.state.cupProgress, checkpoint: this.state.cupProgress?.checkpoint ?? null,
      bestPlacement: this.state.cupProgress?.bestPlacement ?? null, lineup }
    const notice = this.saveCupProgress(progress)
    this.update({ ...this.state, cupProgress: progress, notice })
  }

  private cupTrack(id: string): Track | undefined {
    return OFFICIAL_CIRCUITS.find(({ track }) => track.id === id)?.track ??
      this.library.list().find(track => track.id === id)
  }

  private validateCupTracks(ids: readonly string[]): boolean {
    if (!validCupLineup(ids) || !ids.length || !ids.every(id => {
      const track = this.cupTrack(id)
      return track && validateTrack(track, this.dependencies.geometry.get(track).path.totalLength).ready
    })) {
      this.update({ ...this.state, notice: 'A Cup track is missing or not race-ready. Edit your lineup.' })
      return false
    }
    return true
  }

  private launchCupRace(cup: CircuitCup): void {
    const id = cupTrackIds(cup)[cup.index]
    const track = id && this.cupTrack(id)
    if (!track) {
      this.update({ ...this.state, notice: 'The next Cup track is unavailable.' })
      return
    }
    this.dependencies.raceSession.start(track, {
      car: cup.car,
      difficulty: cup.difficulty,
      laps: 1,
      handling: 'arcade',
      mode: 'normal',
      gridPositions: cupGridPositions(cup),
    })
    const { progress, notice } = this.persistCup(cup)
    this.update({ ...this.state, cup, cupProgress: progress, currentTrack: track, mode: 'race', paused: false, overlay: { type: 'none' }, notice })
  }

  private rememberRace(): void {
    if (!this.dependencies.lastRaceStore) return
    const { track, setup } = this.dependencies.raceSession.snapshot()
    if (!track || !setup) return
    this.dependencies.lastRaceStore?.save({ trackId: track.id, course: courseIdentity(track), setup: { ...setup, handling: setup.handling ?? 'arcade', mode: setup.mode ?? 'normal', lighting: setup.lighting ?? track.lighting } })
  }

  private resolveLastRace(): { race: LastRace; track: Track } | null {
    const race = this.dependencies.lastRaceStore?.load()
    if (!race) return null
    const track = this.dependencies.trackStore.find(race.trackId) ?? OFFICIAL_CIRCUITS.find((entry) => entry.track.id === race.trackId)?.track
    if (!track || courseIdentity(track) !== race.course || !validateTrack(track, this.dependencies.geometry.get(track).path.totalLength).ready) return null
    if (race.setup.mode === 'ghost' && this.dependencies.raceSession.ghostTime?.(track, race.setup) == null) return null
    return { race, track }
  }

  private startRace(): void {
    if (!this.flushPendingEditorSave()) return
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
    if (!this.flushPendingEditorSave()) return
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
    if (!this.flushPendingEditorSave()) return
    const source = this.library.select(id)
    if (!source) return
    if (isSeededTrack(source)) {
      this.applyTrackMutation(this.library.forkSeededForEdit(source, this.creator()), true)
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
    if (!this.flushPendingEditorSave()) return
    const track = OFFICIAL_CIRCUITS.find((entry) => entry.track.id === id)?.track ?? this.library.select(id)
    if (!track) return
    const validation = validateTrack(
      track,
      this.dependencies.geometry.get(track).path.totalLength,
    )
    if (!validation.ready) {
      this.update({ ...this.state, notice: validation.message })
      return
    }
    if (this.state.overlay.type === 'track-library' && this.state.overlay.purpose === 'cup') {
      const lineup = this.state.cupProgress?.lineup ?? DEFAULT_CUP_TRACK_IDS
      if (lineup.length >= 12) {
        this.update({ ...this.state, overlay: { type: 'cup' }, notice: 'Cup is limited to 12 races.' })
      } else {
        this.setCupLineup([...lineup, track.id])
        this.update({ ...this.state, overlay: { type: 'cup' } })
      }
      return
    }
    if (this.state.overlay.type === 'track-library' && this.state.overlay.purpose === 'nearby') {
      if (this.dependencies.nearby?.selectNextTrack(track)) {
        this.update({ ...this.state, overlay: { type: 'results' }, notice: null })
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
    if (!this.flushPendingEditorSave()) return
    const parsed = parseTrackImport(content)
    if (!parsed.ok) {
      this.update({ ...this.state, notice: parsed.message })
      return
    }
    this.applyTrackMutation(this.library.importShared(parsed.track), true)
  }

  private deleteTrack(id: TrackId): void {
    const deletingCurrent = this.state.currentTrack?.id === id
    if (!this.library.delete(id)) {
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
      notice: deletingCurrent ? null : this.state.notice,
    })
    if (!deletingCurrent) this.flushPendingEditorSave()
  }

  private closeOverlay(): void {
    const overlay = this.state.overlay
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
      this.update({ ...this.state, overlay: { type: 'cup' }, notice: null })
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
        overlay: { type: 'track-library', purpose: 'race' },
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
      notice: this.editorSession.hasPendingSave && this.state.notice === 'Save unavailable.'
        ? this.state.notice
        : null,
    })
  }

  private overlayReturn(): OverlayReturn {
    const overlay = this.state.overlay
    if (overlay.type === 'track-library') return overlay
    if (overlay.type === 'editor-menu') return overlay
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
    if (!this.flushPendingEditorSave()) return
    const id = this.state.preferences.creatorId ?? this.pendingCreatorId ??
      (this.dependencies.createCreatorId ?? (() => crypto.randomUUID()))()
    this.pendingCreatorId = id
    const result = this.library.recredit({ id, name })
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
    const currentTrack = tracks.find((track) => track.id === this.state.currentTrack?.id) ??
      this.state.currentTrack
    this.update({
      ...this.state,
      preferences,
      tracks,
      currentTrack,
      overlay: this.state.overlay.type === 'player-name' ? { type: 'none' } : this.state.overlay,
      notice: result.count > 0 ? `Player name saved · ${result.count} track credit${result.count === 1 ? '' : 's'} updated.` : 'Player name saved.',
    })
  }

  private setPreferences(
    preferences: Preferences,
  ): void {
    const saved = this.dependencies.preferencesStore.save(preferences)
    this.dependencies.nearby?.setIdentity(preferences.playerIdentity)
    this.dependencies.nearby?.setDisplayName(preferences.displayName)
    this.update({ ...this.state, preferences, notice: saved ? this.state.notice : 'Preferences could not be saved on this device.' })
  }

  private saveCurrentTrack(): void {
    const track = this.state.currentTrack
    if (!track) return
    const saved = this.editorSession.save(track)
    this.update({
      ...this.state,
      overlay: { type: 'none' },
      notice: saved ? 'Track saved.' : 'Save unavailable.',
    })
  }

  private scoresForTracks(
    tracks: readonly Track[],
  ): Readonly<Record<string, readonly ScoreEntry[]>> {
    return Object.fromEntries(
      [...tracks, ...OFFICIAL_CIRCUITS.map(({ track }) => track)].map((track) => [
        track.id,
        this.dependencies.scoreStore.forTrack(track.id).filter((score) =>
          normalizeRouteKind(score.category?.routeKind) === normalizeRouteKind(track.routeKind)),
      ]),
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
    if (!track) {
      this.update({ ...this.state, editor })
      return
    }
    this.update({
      ...this.state,
      mode: 'editor',
      currentTrack: track,
      tracks: this.state.tracks.map((entry) => entry.id === track.id ? track : entry),
      editor,
      notice: null,
    })
    this.editorSession.queueSave(() => this.flushPendingEditorSave())
  }

  flushPendingEditorSave(): boolean {
    if (!this.editorSession.hasPendingSave) return true
    if (!this.editorSession.save(this.state.currentTrack)) {
      this.update({ ...this.state, notice: 'Save unavailable.' })
      return false
    }
    if (this.state.notice === 'Save unavailable.') {
      this.update({ ...this.state, notice: null })
    }
    return true
  }

  private update(state: AppSnapshot): void {
    let editorUi = state.editorUi
    if (editorUi.tool === 'start' && state.editor.routeKind === 'point-to-point') {
      editorUi = { ...editorUi, tool: 'draw' }
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
