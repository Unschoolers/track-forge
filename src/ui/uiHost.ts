import { exportTrack, shareTrack } from '@/infrastructure/export/trackExport'
import { formatRaceTime } from '@/ui/format'
import type { Track, TrackId } from '@/domain/model'
import type {
  AppCommand,
  AppSnapshot,
} from '@/application/appState'
import type { Unsubscribe } from '@/application/eventBus'
import type { AudioVolumeSetting } from '@/application/audioVolume'
import type { UiHost } from '@/app/createApplication'
import { createEditorChrome } from '@/ui/screens/editorChrome'
import { createHomeScreen } from '@/ui/screens/homeScreen'
import { createRaceHud } from '@/ui/screens/raceHud'
import { createRaceFlyover, type RaceFlyoverPlayback } from '@/ui/components/raceFlyover'
import { DialogController } from '@/ui/dialogController'
import { createEditorMenuModal } from '@/ui/modals/editorMenuModal'
import { createNameModal } from '@/ui/modals/nameModal'
import { createOptionsModal } from '@/ui/modals/optionsModal'
import { createPauseModal } from '@/ui/modals/pauseModal'
import { createRaceSetupModal } from '@/ui/modals/raceSetupModal'
import { createTrackLibraryModal } from '@/ui/modals/trackLibraryModal'
import { createToast } from '@/ui/toast'
import type { RaceSessionPort } from '@/application/race/raceSession'
import type { RaceControlsPort } from '@/application/ports/input'
import { createResultsModal, createCupFinalModal } from '@/ui/modals/resultsModal'
import type { FeedbackPort } from '@/application/ports/feedback'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'

export interface UiEnvironment {
  readonly confirm: (message: string) => boolean
}

export interface UiControllerPort {
  snapshot(): AppSnapshot
  dispatch(command: AppCommand): void
  subscribe(listener: (snapshot: AppSnapshot) => void): Unsubscribe
}

export interface UiRuntime {
  readonly raceSession: RaceSessionPort
  readonly raceControls: RaceControlsPort
  readonly feedback: FeedbackPort
  readonly geometry: TrackGeometryService
  readonly previewAudioVolume?: (setting: AudioVolumeSetting, volume: number) => void
}

export class DomUiHost implements UiHost {
  private unsubscribe: Unsubscribe | undefined
  private screenCleanup: (() => void) | undefined
  private overlayCleanup: (() => void) | undefined
  private flyoverTrackId: TrackId | undefined
  private flyoverPlayback: RaceFlyoverPlayback = { elapsedSeconds: 0 }
  private mounted = false
  private readonly dialogs = new DialogController()
  private readonly environment: UiEnvironment

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: UiControllerPort,
    private readonly runtime: UiRuntime,
    environment: Partial<UiEnvironment> = {},
  ) {
    this.environment = {
      confirm: (message) => window.confirm(message),
      ...environment,
    }
  }

  mount(): void {
    if (this.unsubscribe) return
    this.root.addEventListener('pointerdown', this.onIntent)
    this.root.addEventListener('click', this.onClickFeedback)
    this.mounted = true
    this.render(this.controller.snapshot())
    this.unsubscribe = this.controller.subscribe((snapshot) =>
      this.render(snapshot),
    )
  }

  destroy(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.screenCleanup?.()
    this.screenCleanup = undefined
    this.overlayCleanup?.()
    this.overlayCleanup = undefined
    this.flyoverTrackId = undefined
    this.dialogs.destroy()
    this.root.replaceChildren()
    if (this.mounted) {
      this.root.removeEventListener('pointerdown', this.onIntent)
      this.root.removeEventListener('click', this.onClickFeedback)
      this.mounted = false
    }
  }

  private async exportTrackFile(track: Track): Promise<void> {
    try {
      if (await exportTrack(track)) {
        const toast = createToast('Track file saved.')
        this.root.append(toast)
        setTimeout(() => toast.remove(), 5000)
      }
    } catch {
      const toast = createToast('Export failed. Please try another save location.')
      this.root.append(toast)
      setTimeout(() => toast.remove(), 5000)
    }
  }

  private async shareTrackChallenge(track: Track): Promise<void> {
    const best = this.controller.snapshot().scoresByTrack[track.id]?.[0]
    const challenge = `Race "${track.name}" in Track Forge. ${best ? `Beat my ${formatRaceTime(best.time)}!` : 'Can you win?'} Import the attached track file to play.`
    try {
      if (await shareTrack(track, challenge)) return
    } catch {
      // Saving a copy also works when the system share sheet fails to open.
    }
    await this.exportTrackFile(track)
  }

  private readonly onIntent = (): void => {
    this.runtime.feedback.unlock()
  }

  private readonly onClickFeedback = (event: Event): void => {
    const button = (event.target as Element | null)?.closest('button')
    if (!button) return
    this.runtime.feedback.handle({
      type: 'ui',
      emphasis: button.classList.contains('button-danger')
        ? 'danger'
        : button.classList.contains('button-primary')
          ? 'confirm'
          : 'normal',
    })
  }

  private render(state: AppSnapshot): void {
    this.screenCleanup?.()
    this.screenCleanup = undefined
    this.overlayCleanup?.()
    this.overlayCleanup = undefined
    const isRaceSetup = state.overlay.type === 'race-setup' ||
      (state.overlay.type === 'options' && state.overlay.returnTo === 'race-setup')
    const flyoverTrackId = isRaceSetup ? state.currentTrack?.id : undefined
    if (flyoverTrackId !== this.flyoverTrackId) {
      this.flyoverTrackId = flyoverTrackId
      this.flyoverPlayback = { elapsedSeconds: 0 }
    }
    const home = () => this.controller.dispatch({ type: 'go-home' })
    this.dialogs.beforeRender(this.root, state.overlay)
    const openLibrary = (purpose: 'edit' | 'race') =>
      this.controller.dispatch({ type: 'open-track-library', purpose })
    let screen: HTMLElement
    if (state.mode === 'home') {
      screen = createHomeScreen(state, {
            edit: () => openLibrary('edit'),
            race: () => openLibrary('race'),
            raceAgain: () => this.controller.dispatch({ type: 'race-again' }),
            cup: () => this.controller.dispatch({ type: 'start-cup' }),
            resumeCup: () => this.controller.dispatch({ type: 'resume-cup' }),
            options: () =>
              this.controller.dispatch({
                type: 'open-options',
                returnTo: 'home',
              }),
          })
    } else if (state.mode === 'editor') {
      const geometry = this.runtime.geometry.get({
        points: state.editor.points,
        terrain: state.editor.terrain,
        ...(state.editor.start ? { start: state.editor.start } : {}),
      })
      screen = createEditorChrome(state, {
              home,
              race: () => openLibrary('race'),
              menu: () =>
                this.controller.dispatch({ type: 'open-editor-menu' }),
              rename: () =>
                this.controller.dispatch({
                  type: 'open-track-name',
                  purpose: 'rename',
                }),
              save: () =>
                this.controller.dispatch({
                  type: 'save-current-track',
                }),
              load: () => openLibrary('edit'),
              tool: (tool) =>
                this.controller.dispatch({
                  type: 'set-editor-tool',
                  tool,
                }),
              surface: (surface) =>
                this.controller.dispatch({
                  type: 'set-editor-surface',
                  surface,
                }),
              structure: (structure) =>
                this.controller.dispatch({
                  type: 'set-editor-structure',
                  structure,
                }),
              terrainMode: (mode) =>
                this.controller.dispatch({
                  type: 'set-editor-terrain-mode',
                  mode,
                }),
              terrainRadius: (radius) =>
                this.controller.dispatch({
                  type: 'set-editor-terrain-radius',
                  radius,
                }),
              camera: (action) =>
                this.controller.dispatch({
                  type: 'request-editor-camera',
                  action,
                }),
              toggleGrid: () =>
                this.controller.dispatch({
                  type: 'toggle-editor-grid',
                }),
              edit: (command) =>
                this.controller.dispatch({ type: 'editor', command }),
            }, geometry)
    } else {
      const raceHud = createRaceHud(
        state,
        this.runtime.raceSession,
        this.runtime.raceControls,
        {
          pause: () =>
            this.controller.dispatch({
              type: state.paused ? 'resume-race' : 'pause-race',
            }),
        },
      )
      screen = raceHud.element
      this.screenCleanup = () => raceHud.destroy()
    }
    const overlay = this.renderOverlay(state)
    const nodes: Node[] = [screen]
    if (overlay) nodes.push(overlay)
    if (state.notice && state.overlay.type !== 'track-name') {
      nodes.push(createToast(state.notice))
    }
    this.root.replaceChildren(...nodes)
    this.dialogs.afterRender(this.root, state.overlay, () =>
      this.controller.dispatch({ type: 'close-overlay' }),
    )
  }

  private renderOverlay(state: AppSnapshot): HTMLElement | undefined {
    const close = () => this.controller.dispatch({ type: 'close-overlay' })
    switch (state.overlay.type) {
      case 'none':
        return undefined
      case 'cup-final':
        return state.cup ? createCupFinalModal(state.cup, () => this.controller.dispatch({ type: 'next-cup-race' })) : undefined
      case 'results': {
        const result = this.runtime.raceSession.snapshot().result
        return result
          ? createResultsModal(result, {
              retry: () =>
                this.controller.dispatch({ type: 'restart-race' }),
              raceBestGhost: (() => {
                const { track, setup } = this.runtime.raceSession.snapshot()
                return track && setup && this.runtime.raceSession.ghostTime?.(track, setup) != null
                  ? () => this.controller.dispatch({ type: 'race-best-ghost' }) : undefined
              })(),
              changeTrack: () => this.controller.dispatch({ type: 'open-track-library', purpose: 'race' }),
              edit: () =>
                this.controller.dispatch({ type: 'open-editor' }),
              home: () => this.controller.dispatch({ type: 'go-home' }),
            }, state.cup ? { cup: state.cup, next: () => this.controller.dispatch({ type: 'next-cup-race' }) } : undefined, state.newTimeMedal)
          : undefined
      }
      case 'track-library':
        return createTrackLibraryModal(state, {
          close,
          create: () =>
            this.controller.dispatch({
              type: 'open-track-name',
              purpose: 'create',
            }),
          selectForEdit: (id) =>
            this.controller.dispatch({
              type: 'select-track-for-edit',
              id,
            }),
          selectForRace: (id) =>
            this.controller.dispatch({
              type: 'select-track-for-race',
              id,
            }),
          share: (track) => { void this.shareTrackChallenge(track) },
          importFile: (content) => this.controller.dispatch({ type: 'import-track', content }),
          delete: (track) => {
            if (this.environment.confirm(`Delete "${track.name}"?`)) {
              this.controller.dispatch({
                type: 'delete-track',
                id: track.id,
              })
            }
          },
        }, this.runtime.geometry)
      case 'track-name':
        return createNameModal(state, {
          close,
          submit: (name) =>
            this.controller.dispatch({
              type:
                state.overlay.type === 'track-name' &&
                state.overlay.purpose === 'rename'
                  ? 'rename-track'
                  : 'create-track',
              name,
            }),
        })
      case 'race-setup': {
        const { currentTrack, preferences } = state
        const ghostSetup = {
          car: preferences.car,
          difficulty: preferences.difficulty,
          laps: preferences.raceLaps ?? 2,
          handling: preferences.handling ?? 'arcade',
        } as const
        const availability = currentTrack
          ? this.runtime.raceSession.ghostAvailability?.(currentTrack, ghostSetup) ??
            (() => { const time = this.runtime.raceSession.ghostTime?.(currentTrack, ghostSetup); return time == null ? { kind: 'none' as const } : { kind: 'exact' as const, time } })()
          : { kind: 'none' as const }
        const ghostTime = availability.kind === 'exact' ? availability.time : null
        const geometry = currentTrack && this.runtime.geometry.get(currentTrack)
        const flyover = currentTrack && geometry && geometry.path.points.length > 1
          ? createRaceFlyover(
              currentTrack,
              geometry,
              preferences.car,
              state.raceLighting ?? currentTrack.lighting,
              preferences.raceMode === 'ghost' && ghostTime !== null && Number.isFinite(ghostTime) && ghostTime > 0,
              this.flyoverPlayback,
            )
          : undefined
        this.overlayCleanup = flyover?.destroy
        return createRaceSetupModal(state, {
          close,
          lighting: (lighting) => this.controller.dispatch({ type: 'set-race-lighting', lighting }),
          options: () => this.controller.dispatch({ type: 'open-options', returnTo: 'race-setup' }),
          preferences: (preferences) =>
            this.controller.dispatch({
              type: 'set-preferences',
              preferences,
            }),
          start: () =>
            this.controller.dispatch({ type: 'start-race' }),
        }, availability, flyover?.element)
      }
      case 'options':
        return createOptionsModal(state, {
          close,
          previewVolume: (setting, volume) => this.runtime.previewAudioVolume?.(setting, volume),
          setVolume: (setting, volume) => this.controller.dispatch({
            type: 'set-preferences',
            preferences: {
              ...this.controller.snapshot().preferences,
              ...(setting === 'soundEffectsVolume' ? { audioEnabled: volume > 0 } : {}),
              [setting]: volume,
            },
          }),
          preferences: (preferences) =>
            this.controller.dispatch({
              type: 'set-preferences',
              preferences,
            }),
        })
      case 'pause':
        return createPauseModal({
          resume: () =>
            this.controller.dispatch({ type: 'resume-race' }),
          restart: () =>
            this.controller.dispatch({ type: 'restart-race' }),
          options: () =>
            this.controller.dispatch({
              type: 'open-options',
              returnTo: 'race',
            }),
          home: () => this.controller.dispatch({ type: 'go-home' }),
        })
      case 'editor-menu':
        return createEditorMenuModal({
          close,
          export: () => {
            const track = this.controller.snapshot().currentTrack
            if (track) void this.exportTrackFile(track)
          },
          save: () =>
            this.controller.dispatch({ type: 'save-current-track' }),
          rename: () =>
            this.controller.dispatch({
              type: 'open-track-name',
              purpose: 'rename',
            }),
          choose: () =>
            this.controller.dispatch({
              type: 'open-track-library',
              purpose: 'edit',
            }),
          options: () =>
            this.controller.dispatch({
              type: 'open-options',
              returnTo: 'editor',
            }),
          home: () => this.controller.dispatch({ type: 'go-home' }),
        })
    }
  }
}
