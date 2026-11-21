import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import { createNearbyRaceMenu, createNearbyRaceModal, createNearbyRaceResults } from '@/ui/modals/nearbyRaceModal'
import { exportTrack, saveJsonFile, shareTrack } from '@/infrastructure/export/trackExport'
import { formatRaceTime } from '@/ui/format'
import type { LightingMode, Track, TrackId } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type {
  AppCommand,
  AppSnapshot,
} from '@/application/appState'
import type { Unsubscribe } from '@/application/eventBus'
import type { AudioVolumeSetting } from '@/application/audioVolume'
import type { UpdateInfo, UpdateProvider } from '@/application/updates/updateProvider'
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
import { updateStandings } from '@/ui/components/scoreboard'
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
  readonly nearby?: NearbyRace | undefined
  readonly raceSession: RaceSessionPort
  readonly raceControls: RaceControlsPort
  readonly feedback: FeedbackPort
  readonly geometry: TrackGeometryService
  readonly prepareRace?: (track: Track, geometry: TrackGeometry, lighting: LightingMode) => () => void
  readonly previewAudioVolume?: (setting: AudioVolumeSetting, volume: number) => void
  readonly updateProvider?: UpdateProvider
}

export class DomUiHost implements UiHost {
  private unsubscribe: Unsubscribe | undefined
  private screenCleanup: (() => void) | undefined
  private overlayCleanup: (() => void) | undefined
  private racePreparation: { track: Track; lighting: LightingMode; cancel: () => void } | undefined
  private flyoverTrackId: TrackId | undefined
  private flyoverPlayback: RaceFlyoverPlayback = { elapsedSeconds: 0 }
  private mounted = false
  private readonly dialogs = new DialogController()
  private readonly environment: UiEnvironment
  private availableUpdate: UpdateInfo | null = null
  private updateCheckPending = false
  private lastUpdateCheckAt = Number.NEGATIVE_INFINITY
  private updateCheckGeneration = 0
  private previousOverlayType: AppSnapshot['overlay']['type'] = 'none'

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
    this.cancelRacePreparation()
    this.flyoverTrackId = undefined
    this.dialogs.destroy()
    this.updateCheckGeneration++
    this.updateCheckPending = false
    this.availableUpdate = null
    this.lastUpdateCheckAt = Number.NEGATIVE_INFINITY
    this.previousOverlayType = 'none'
    this.root.replaceChildren()
    if (this.mounted) {
      this.root.removeEventListener('pointerdown', this.onIntent)
      this.root.removeEventListener('click', this.onClickFeedback)
      this.mounted = false
    }
  }

  private checkForUpdates(): void {
    if (!this.runtime.updateProvider || this.updateCheckPending) return
    const now = Date.now()
    // Visiting Home repeatedly must not issue an update request each render.
    if (now - this.lastUpdateCheckAt < 30 * 60 * 1000) return
    this.lastUpdateCheckAt = now
    this.updateCheckPending = true
    const generation = this.updateCheckGeneration
    void this.runtime.updateProvider.check().then((update) => {
      if (!this.mounted || generation !== this.updateCheckGeneration) return
      const wasAvailable = this.availableUpdate?.version
      this.availableUpdate = update
      if (wasAvailable !== update?.version) {
        const state = this.controller.snapshot()
        if (state.mode === 'home' && state.overlay.type === 'none') this.render(state)
      }
    }).catch((error: unknown) => {
      // Never report "up to date" when GitHub cannot be reached.
      console.error('Track Forge automatic update check failed:', error)
    }).finally(() => {
      if (generation === this.updateCheckGeneration) this.updateCheckPending = false
    })
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

  private async exportRaceDiagnostics(): Promise<void> {
    const report = this.runtime.raceSession.diagnosticsReport?.()
    if (!report) {
      this.showRaceExportNotice('Race replay is no longer available.')
      return
    }
    const trackName = report.track.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 48) || 'track'
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      const saved = await saveJsonFile({
        filename: `trackforge-race-${trackName}-${timestamp}.json`,
        content: JSON.stringify(report),
      })
      this.showRaceExportNotice(saved ? 'Race replay file saved.' : 'Race replay was not saved.')
    } catch (error) {
      console.error('Track Forge race replay export failed:', error)
      this.showRaceExportNotice('Race export failed. Please try another save location.')
    }
  }

  private showRaceExportNotice(message: string): void {
    const toast = createToast(message)
    this.root.append(toast)
    setTimeout(() => toast.remove(), 5000)
  }

  private async downloadNearbyDiagnostics(nearby: NearbyRace): Promise<boolean> {
    const capturedAt = new Date().toISOString()
    const report = { capturedAt, ...await nearby.diagnostics() }
    const timestamp = capturedAt.replace(/[:.]/g, '-')
    return saveJsonFile({ filename: `trackforge-nearby-${timestamp}.json`, content: JSON.stringify(report, null, 2) })
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

  private cancelRacePreparation(): void {
    this.racePreparation?.cancel()
    this.racePreparation = undefined
  }

  private render(state: AppSnapshot): void {
    this.screenCleanup?.()
    this.screenCleanup = undefined
    this.overlayCleanup?.()
    this.overlayCleanup = undefined
    if (
      state.overlay.type !== 'race-setup' ||
      this.racePreparation?.track !== state.currentTrack ||
      this.racePreparation?.lighting !== (state.raceLighting ?? state.currentTrack?.lighting)
    ) {
      this.cancelRacePreparation()
    }
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
            nearby: this.runtime.nearby ? () => this.controller.dispatch({ type: 'open-nearby' }) : undefined,
            raceAgain: () => this.controller.dispatch({ type: 'race-again' }),
            cup: () => this.controller.dispatch({ type: 'start-cup' }),
            resumeCup: () => this.controller.dispatch({ type: 'resume-cup' }),
            options: () =>
              this.controller.dispatch({
                type: 'open-options',
                returnTo: 'home',
              }),
            updates: this.availableUpdate ? () =>
              this.controller.dispatch({
                type: 'open-options',
                returnTo: 'home',
                tab: 'updates',
              }) : undefined,
          })
    } else if (state.mode === 'editor') {
      const geometry = this.runtime.geometry.get({
        routeKind: state.editor.routeKind,
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
              scenery: (choice) =>
                this.controller.dispatch({ type: 'set-editor-scenery', choice }),
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
    this.previousOverlayType = state.overlay.type
    if (state.mode === 'home' && state.overlay.type === 'none') this.checkForUpdates()
  }

  private renderOverlay(state: AppSnapshot): HTMLElement | undefined {
    const close = () => this.controller.dispatch({ type: 'close-overlay' })
    switch (state.overlay.type) {
      case 'none':
        return undefined
      case 'nearby': {
        const nearby = this.runtime.nearby
        if (!nearby) return undefined
        return createNearbyRaceModal(nearby, state.preferences.car, {
          close,
          downloadDiagnostics: () => this.downloadNearbyDiagnostics(nearby),
          chooseTrack: () => this.controller.dispatch({ type: 'open-track-library', purpose: 'race' }),
          scan: () => this.controller.dispatch({ type: 'scan-nearby' }),
          scanTracks: () => this.controller.dispatch({ type: 'scan-nearby-track' }),
          saveTrack: () => this.controller.dispatch({ type: 'save-nearby-track' }),
          declineTrack: () => this.controller.dispatch({ type: 'decline-nearby-track' }),
          selectCar: (car) => this.controller.dispatch({ type: 'set-preferences', preferences: { ...state.preferences, car } }),
          toggleCustomize: () => this.controller.dispatch({ type: 'toggle-nearby-customize' }),
          selectIdentity: (playerIdentity) => this.controller.dispatch({ type: 'set-preferences', preferences: { ...state.preferences, playerIdentity } }),
        }, state.preferences.playerIdentity, state.overlay.customize)
      }
      case 'cup-final':
        return state.cup ? createCupFinalModal(state.cup, () => this.controller.dispatch({ type: 'next-cup-race' })) : undefined
      case 'results': {
        const result = this.runtime.raceSession.snapshot().result
        if (!result) return undefined
        const nearby = this.runtime.nearby
        if (result.mode === 'nearby' && nearby) {
          const results = createNearbyRaceResults(nearby, result, {
            leave: () => this.controller.dispatch({ type: 'leave-nearby' }),
            race: () => this.controller.dispatch({ type: 'nearby-race-again' }),
            selectTrack: () => this.controller.dispatch({ type: 'nearby-select-next-track' }),
            downloadDiagnostics: () => this.downloadNearbyDiagnostics(nearby),
          })
          this.overlayCleanup = results.cleanup
          return results.element
        }
        const modal = createResultsModal(result, {
          retry: () => this.controller.dispatch({ type: 'restart-race' }),
          exportRace: this.runtime.raceSession.diagnosticsReport ? () => { void this.exportRaceDiagnostics() } : undefined,
          diagnosticsOpened: () => this.runtime.feedback.handle({ type: 'ui', emphasis: 'confirm' }),
          raceBestGhost: (() => {
            const { track, setup } = this.runtime.raceSession.snapshot()
            return track && setup && this.runtime.raceSession.ghostTime?.(track, setup) != null
              ? () => this.controller.dispatch({ type: 'race-best-ghost' }) : undefined
          })(),
          changeTrack: () => this.controller.dispatch({ type: 'open-track-library', purpose: 'race' }),
          edit: () => this.controller.dispatch({ type: 'open-editor' }),
          home: () => this.controller.dispatch({ type: 'go-home' }),
        }, state.cup ? { cup: state.cup, next: () => this.controller.dispatch({ type: 'next-cup-race' }) } : undefined, state.newTimeMedal)
        const standings = modal.querySelector<HTMLElement>('[data-results-standings]')
        if (standings && result.rivalsFinishing) {
          let previous = result
          this.overlayCleanup = this.runtime.raceSession.subscribe(({ result: next }) => {
            if (!next || next === previous) return
            previous = next
            updateStandings(standings, next.standings, next.rivalsFinishing)
          })
        }
        return modal
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
          ...(this.runtime.nearby && state.overlay.purpose !== 'nearby'
            ? { sendNearby: (track: Track) => this.controller.dispatch({ type: 'send-nearby-track', track }) }
            : {}),
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
        const lighting = state.raceLighting ?? currentTrack?.lighting ?? 'day'
        const ghostSetup = {
          car: preferences.car,
          difficulty: preferences.difficulty,
          laps: currentTrack?.routeKind === 'point-to-point' ? 1 : preferences.raceLaps ?? 2,
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
              lighting,
              preferences.raceMode === 'ghost' && ghostTime !== null && Number.isFinite(ghostTime) && ghostTime > 0,
              this.flyoverPlayback,
            )
          : undefined
        this.overlayCleanup = flyover?.destroy
        if (currentTrack && geometry && flyover && !this.racePreparation) {
          const cancel = this.runtime.prepareRace?.(currentTrack, geometry, lighting)
          if (cancel) this.racePreparation = { track: currentTrack, lighting, cancel }
        }
        return createRaceSetupModal(state, {
          close,
          hostNearby: this.runtime.nearby ? () => this.controller.dispatch({ type: 'host-nearby' }) : undefined,
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
        }, {
          initialTab: this.previousOverlayType !== 'options' ? state.overlay.tab : undefined,
          availableUpdate: this.availableUpdate,
        })
      case 'pause':
        if (this.runtime.raceSession.snapshot().setup?.mode === 'nearby') {
          return createNearbyRaceMenu(
            () => this.controller.dispatch({ type: 'resume-race' }),
            () => this.controller.dispatch({ type: 'leave-nearby' }),
          )
        }
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
        return createEditorMenuModal(state.editor.environmentId, state.editor.routeKind, {
          close,
          setRouteKind: (routeKind) =>
            this.controller.dispatch({ type: 'editor', command: { type: 'set-route-kind', routeKind } }),
          setEnvironment: (environmentId) =>
            this.controller.dispatch({
              type: 'editor',
              command: { type: 'set-environment', environmentId },
            }),
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
