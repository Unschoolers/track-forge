import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import { normalizeEditorSceneryChoice } from '@/application/appState'
import { courseIdentity, timeMedal } from '@/application/race/raceRecords'
import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { CUP_CIRCUITS, cupStandings, createCup, recordCupResult, retryCupRace, advanceCup, type CircuitCup, type CupProgress } from '@/application/race/circuitCup'
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
}

export class AppController {
  private readonly events = new EventBus<AppEvent>()
  private readonly now: () => number
  private readonly library: TrackLibraryService
  private state: AppSnapshot
  private preCupTrack: Track | null = null
  private readonly editorSession: EditorSession
  private beforeNearbyTrack: Track | null | undefined
  private readonly unsubscribeNearby: (() => void) | undefined
  private readonly unsubscribeNearbyStart: (() => void) | undefined
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
      cupProgress: dependencies.cupStore?.load() ?? { checkpoint: null, bestPlacement: null },
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
    this.unsubscribeNearbyStart = dependencies.nearby?.onStart(({ track, car, laps, lighting, startsAt }) => {
      if (this.state.overlay.type !== 'nearby') return
      this.beforeNearbyTrack = this.state.currentTrack
      dependencies.raceSession.start(track, {
        car, laps, lighting, difficulty: this.state.preferences.difficulty, handling: 'arcade', mode: 'nearby',
      }, startsAt)
      this.update({ ...this.state, mode: 'race', currentTrack: track, paused: false, cup: null, overlay: { type: 'none' }, notice: null })
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
        if (this.state.currentTrack && OFFICIAL_CIRCUITS.some(({ track }) => track.id === this.state.currentTrack?.id)) {
          const copy = this.library.importShared(this.state.currentTrack)
          if (!copy.ok) { this.update({ ...this.state, notice: copy.message }); break }
          this.applyTrackMutation(copy, true)
          break
        }
        this.update({ ...this.state, cup: null, mode: 'editor', paused: false, overlay: { type: 'none' }, notice: null })
        break
      case 'start-cup':
        if (!this.flushPendingEditorSave()) break
        this.preCupTrack = this.state.currentTrack
        this.launchCupRace(createCup(this.state.preferences.car, this.state.preferences.difficulty))
        break
      case 'resume-cup': {
        const cup = this.state.cupProgress?.checkpoint
        if (!cup) break
        this.preCupTrack = this.state.currentTrack
        if (cup.rounds.length > cup.index && cup.index === CUP_CIRCUITS.length - 1) {
          this.update({ ...this.state, cup, overlay: { type: 'cup-final' } })
        } else {
          this.launchCupRace(cup.rounds.length > cup.index ? advanceCup(cup) : cup)
        }
        break
      }
      case 'next-cup-race':
        if (this.state.cup && (this.state.overlay.type === 'results' || this.state.overlay.type === 'cup-final')) {
          if (this.state.cup.index === CUP_CIRCUITS.length - 1) {
            const placement = cupStandings(this.state.cup).findIndex((driver) => driver.id === 'player') + 1
            const previous = this.state.cupProgress?.bestPlacement ?? null
            const progress = { checkpoint: null, bestPlacement: placement > 0 ? Math.min(previous ?? placement, placement) : previous }
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
        this.dependencies.raceSession.start(saved.track, saved.race.setup)
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
        this.startRace()
        break
      case 'open-nearby':
        if (this.dependencies.nearby) this.update({ ...this.state, overlay: { type: 'nearby' }, notice: null })
        break
      case 'host-nearby': {
        const { currentTrack: track, preferences, raceLighting } = this.state
        const nearby = this.dependencies.nearby
        if (!nearby || !track || !this.flushPendingEditorSave() ||
            !validateTrack(track, this.dependencies.geometry.get(track).path.totalLength).ready) break
        this.update({ ...this.state, overlay: { type: 'nearby' }, notice: null })
        nearby.host({
          track, car: preferences.car, lighting: raceLighting ?? track.lighting,
          laps: track.routeKind === 'point-to-point' ? 1 : preferences.raceLaps ?? 2,
        })
        break
      }
      case 'scan-nearby':
        if (this.state.overlay.type === 'nearby') {
          this.dependencies.nearby?.scan(this.state.preferences.car)
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
        this.flushPendingEditorSave()
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
      case 'open-options':
        this.update({
          ...this.state,
          overlay: {
            type: 'options',
            returnTo: command.returnTo,
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
        this.update({ ...this.state, editorUi: { ...this.state.editorUi, sceneryChoice: normalizeEditorSceneryChoice(command.choice, this.state.editor.environmentId) } })
        break
      case 'set-editor-tool':
        this.update({
          ...this.state,
          editorUi: {
            ...this.state.editorUi,
            tool: command.tool,
            selectedCrossing:
              command.tool === 'select'
                ? this.state.editorUi.selectedCrossing
                : null,
            selectedPoint:
              command.tool === 'select'
                ? this.state.editorUi.selectedPoint
                : null,
          },
        })
        break
      case 'select-editor-crossing':
        this.update({
          ...this.state,
          editorUi: {
            ...this.state.editorUi,
            selectedCrossing: command.key,
            selectedPoint: command.key === null
              ? this.state.editorUi.selectedPoint
              : null,
          },
        })
        break
      case 'select-editor-point':
        this.update({
          ...this.state,
          editorUi: {
            ...this.state.editorUi,
            selectedPoint: command.index,
            selectedCrossing:
              command.index === null
                ? this.state.editorUi.selectedCrossing
                : null,
          },
        })
        break
      case 'set-editor-surface':
        this.update({
          ...this.state,
          editorUi: {
            ...this.state.editorUi,
            surface: command.surface,
          },
        })
        break
      case 'set-editor-structure':
        this.update({
          ...this.state,
          editorUi: {
            ...this.state.editorUi,
            structure: command.structure,
          },
        })
        break
      case 'set-editor-terrain-mode':
        this.update({
          ...this.state,
          editorUi: {
            ...this.state.editorUi,
            terrainBrush: {
              ...this.state.editorUi.terrainBrush,
              mode: command.mode,
            },
          },
        })
        break
      case 'set-editor-terrain-radius':
        this.update({
          ...this.state,
          editorUi: {
            ...this.state.editorUi,
            terrainBrush: {
              ...this.state.editorUi.terrainBrush,
              radius: command.radius,
            },
          },
        })
        break
      case 'toggle-editor-grid':
        this.update({
          ...this.state,
          editorUi: {
            ...this.state.editorUi,
            grid: !this.state.editorUi.grid,
          },
        })
        break
      case 'request-editor-camera':
        this.update({
          ...this.state,
          editorUi: {
            ...this.state.editorUi,
            cameraRequest: {
              sequence:
                (this.state.editorUi.cameraRequest?.sequence ?? 0) + 1,
              action: command.action,
            },
          },
        })
        break
      case 'create-track':
        if (!this.flushPendingEditorSave()) break
        this.applyTrackMutation(this.library.create(command.name), true)
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
    this.dependencies.nearby?.destroy()
    this.dependencies.raceSession.destroy()
  }

  private saveCupProgress(progress: CupProgress): string | null {
    return this.dependencies.cupStore?.save(progress) === false
      ? 'Cup progress could not be saved on this device.'
      : null
  }

  private persistCup(checkpoint: CircuitCup): { progress: CupProgress; notice: string | null } {
    const progress = { checkpoint, bestPlacement: this.state.cupProgress?.bestPlacement ?? null }
    return { progress, notice: this.saveCupProgress(progress) }
  }

  private launchCupRace(cup: CircuitCup): void {
    const track = CUP_CIRCUITS[cup.index]?.track
    if (!track) return
    this.dependencies.raceSession.start(track, {
      car: cup.car,
      difficulty: cup.difficulty,
      laps: 1,
      handling: 'arcade',
      mode: 'normal',
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
      const pointToPoint = track.routeKind === 'point-to-point'
      const preferredMode = this.state.preferences.raceMode ?? 'normal'
      this.dependencies.raceSession.start(track, {
        car: this.state.preferences.car,
        difficulty: this.state.preferences.difficulty,
        laps: pointToPoint ? 1 : this.state.preferences.raceLaps ?? 2,
        handling: this.state.preferences.handling ?? 'arcade',
        mode: !pointToPoint && preferredMode === 'time-trial' ? 'normal' : preferredMode,
        lighting: this.state.overlay.type === 'race-setup' ? this.state.raceLighting ?? track.lighting : track.lighting,
      })
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
    const track = this.library.select(id)
    if (!track) return
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

  private setPreferences(
    preferences: Preferences,
  ): void {
    this.dependencies.preferencesStore.save(preferences)
    this.update({ ...this.state, preferences })
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
