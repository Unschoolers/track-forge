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
  applyEditorCommand,
  createEditorState,
  type EditorCommand,
} from '@/domain/editor/editorState'
import { DEFAULT_TERRAIN_BRUSH_RADIUS } from '@/domain/config'
import {
  TrackLibraryService,
  type TrackMutationResult,
} from '@/application/library/trackLibraryService'
import { parseTrackImport } from '@/application/library/trackImport'
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

export interface Scheduler {
  schedule(delayMs: number, task: () => void): () => void
}

export interface AppControllerDependencies {
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
  private cancelPendingSave: (() => void) | undefined
  private pendingEditorSave = false
  private saveGeneration = 0
  private unsubscribeRace: (() => void) | undefined

  constructor(private readonly dependencies: AppControllerDependencies) {
    this.now = dependencies.now ?? (() => Date.now())
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
    this.unsubscribeRace = dependencies.raceSession.subscribe((snapshot) => {
      if (
        snapshot.result &&
        this.state.mode === 'race' &&
        this.state.overlay.type !== 'results'
      ) {
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
      }
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
        if (this.state.mode === 'race') {
          this.dependencies.raceSession.setPaused(true)
        }
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
          if (this.state.mode === 'race') this.dependencies.raceSession.setPaused(true)
          this.applyTrackMutation(copy, true)
          break
        }
        if (this.state.mode === 'race') {
          this.dependencies.raceSession.setPaused(true)
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
          editor: createEditorState(saved.track.points, saved.track.trees, saved.track.start, saved.track.terrain),
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
      case 'pause-race':
        if (this.state.mode === 'race') {
          this.dependencies.raceSession.setPaused(true)
          this.update({
            ...this.state,
            paused: true,
            overlay: { type: 'pause' },
          })
        }
        break
      case 'resume-race':
        if (this.state.mode === 'race') {
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
        if (this.state.mode === 'race' && track && setup &&
            this.dependencies.raceSession.ghostTime?.(track, setup) != null) {
          this.dependencies.raceSession.start(track, { ...setup, mode: 'ghost' })
          if (!this.state.cup) this.rememberRace()
          this.update({ ...this.state, paused: false, overlay: { type: 'none' }, notice: null })
        }
        break
      }
      case 'restart-race':
        if (this.state.mode === 'race') {
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
        if (this.state.mode === 'race') this.dependencies.raceSession.setPaused(true)
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
      this.dependencies.raceSession.start(track, {
        car: this.state.preferences.car,
        difficulty: this.state.preferences.difficulty,
        laps: this.state.preferences.raceLaps ?? 2,
        handling: this.state.preferences.handling ?? 'arcade',
        mode: this.state.preferences.raceMode ?? 'normal',
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
    this.cancelPendingEditorSave()
    this.update({
      ...this.state,
      currentTrack: track,
      editor: createEditorState(
        track.points,
        track.trees,
        track.start,
        track.terrain,
      ),
      notice: null,
    })
  }

  private selectTrackForEdit(id: TrackId): void {
    if (!this.flushPendingEditorSave()) return
    const track = this.library.select(id)
    if (!track) return
    this.cancelPendingEditorSave()
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
    this.cancelPendingEditorSave()
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
    this.cancelPendingEditorSave()
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
      this.cancelPendingEditorSave()
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
            )
          : this.state.editor,
      notice: deletingCurrent ? null : this.state.notice,
    })
    if (!deletingCurrent) this.flushPendingEditorSave()
  }

  private closeOverlay(): void {
    const overlay = this.state.overlay
    if (overlay.type === 'cup-final') {
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
      notice: this.pendingEditorSave && this.state.notice === 'Save unavailable.'
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
    this.cancelPendingSave?.()
    this.cancelPendingSave = undefined
    this.saveGeneration++
    const saved = this.dependencies.trackStore.save(track)
    this.pendingEditorSave = !saved
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
        this.dependencies.scoreStore.forTrack(track.id),
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
    const result = applyEditorCommand(this.state.editor, command)
    if (result.rejection) {
      this.update({ ...this.state, notice: result.rejection.message })
      return
    }
    const editor = result.state
    if (editor === this.state.editor) return
    const contentChanged =
      editor.points !== this.state.editor.points ||
      editor.trees !== this.state.editor.trees ||
      editor.start !== this.state.editor.start ||
      editor.terrain !== this.state.editor.terrain
    if (!contentChanged) {
      this.update({ ...this.state, editor })
      return
    }
    const updatedTrack = {
      ...currentTrack,
      points: editor.points,
      trees: editor.trees,
      start: editor.start ?? { ratio: 0, reversed: false },
      terrain: editor.terrain,
      updatedAt: this.now(),
    }
    this.update({
      ...this.state,
      mode: 'editor',
      currentTrack: updatedTrack,
      tracks: this.state.tracks.map((track) =>
        track.id === updatedTrack.id ? updatedTrack : track,
      ),
      editor,
      notice: null,
    })
    this.cancelPendingSave?.()
    this.pendingEditorSave = true
    const generation = ++this.saveGeneration
    this.cancelPendingSave = this.dependencies.scheduler.schedule(120, () => {
      if (generation !== this.saveGeneration) return
      this.flushPendingEditorSave()
    })
  }

  flushPendingEditorSave(): boolean {
    if (!this.pendingEditorSave) return true
    this.cancelPendingSave?.()
    this.cancelPendingSave = undefined
    this.saveGeneration++
    const track = this.state.currentTrack
    if (!track || !this.dependencies.trackStore.save(track)) {
      this.update({ ...this.state, notice: 'Save unavailable.' })
      return false
    }
    this.pendingEditorSave = false
    if (this.state.notice === 'Save unavailable.') {
      this.update({ ...this.state, notice: null })
    }
    return true
  }

  private cancelPendingEditorSave(): void {
    this.cancelPendingSave?.()
    this.cancelPendingSave = undefined
    this.pendingEditorSave = false
    this.saveGeneration++
  }

  private update(state: AppSnapshot): void {
    this.state = state
    this.events.publish({ type: 'state-changed', snapshot: state })
  }
}
