import type { NearbyRace } from '@/application/multiplayer/nearbyRace'
import type { NearbyConnectionModes } from '@/infrastructure/multiplayer/selectNearbyConnection'
import { createNearbyLeaveConfirmation, createNearbyRaceMenu, createNearbyRaceModal, createNearbyRaceResults } from '@/ui/modals/nearbyRaceModal'
import { exportTrack, saveJsonFile, shareTrack } from '@/infrastructure/export/trackExport'
import { raceDiagnosticsFilename } from '@/infrastructure/export/raceExportName'
import { formatRaceTime } from '@/ui/format'
import type { CreatorGhostChallenge, LightingMode, Track } from '@/domain/model'
import { CAR_SPECS } from '@/domain/config'
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
import { createEditorDiagnosticsMemo } from '@/ui/editor/editorFrameControls'
import { isSceneryRotationPreviewOnly } from '@/application/editor/sceneryRotationPreview'
import { deferEditorDragChrome } from '@/ui/editor/editorDragRendering'
import { createHomeScreen } from '@/ui/screens/homeScreen'
import { createRaceHud } from '@/ui/screens/raceHud'
import { RaceFlyoverLifecycle } from '@/ui/components/raceFlyover'
import { DialogController } from '@/ui/dialogController'
import { attachMenuGlass } from '@/ui/menu/menuGlass'
import { attachGlassTouch } from '@/ui/menu/glassTouch'
import { attachEditorGlass } from '@/ui/menu/editorGlass'
import { createCupModal } from '@/ui/modals/cupModal'
import { createEditorMenuModal } from '@/ui/modals/editorMenuModal'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { button, element } from '@/ui/dom'
import { createEditorExitModal } from '@/ui/modals/editorExitModal'
import { createNameModal } from '@/ui/modals/nameModal'
import { createPlayerNameModal } from '@/ui/modals/playerNameModal'
import { createOptionsModal } from '@/ui/modals/optionsModal'
import { createPauseModal } from '@/ui/modals/pauseModal'
import { createRaceSetupModal } from '@/ui/modals/raceSetupModal'
import { createTrackLibraryModal, type TrackLibraryViewState } from '@/ui/modals/trackLibraryModal'
import { isSeededTrack } from '@/domain/track/trackCreator'
import { isSharedTrack } from '@/domain/track/trackAccess'
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
  readonly nearbyConnections?: NearbyConnectionModes
  readonly raceSession: RaceSessionPort
  readonly frameDiagnostics?: () => unknown
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
  private materialCleanup: (() => void) | undefined
  private touchCleanup: (() => void) | undefined
  private racePreparation: { track: Track; lighting: LightingMode; cancel: () => void } | undefined
  private readonly flyover = new RaceFlyoverLifecycle()
  private mounted = false
  private previousSnapshot: AppSnapshot | undefined
  private readonly dialogs = new DialogController()
  private readonly editorDiagnosticsMemo = createEditorDiagnosticsMemo()
  private readonly environment: UiEnvironment
  private availableUpdate: UpdateInfo | null = null
  private updateCheckPending = false
  private lastUpdateCheckAt = Number.NEGATIVE_INFINITY
  private updateCheckGeneration = 0
  private previousOverlayType: AppSnapshot['overlay']['type'] = 'none'
  private trackLibraryViewState: TrackLibraryViewState | undefined
  private readonly noticeTimers = new Set<ReturnType<typeof setTimeout>>()
  private noticeGeneration = 0

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
    this.touchCleanup = attachGlassTouch(this.root)
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
    this.materialCleanup?.()
    this.materialCleanup = undefined
    this.touchCleanup?.()
    this.touchCleanup = undefined
    this.cancelRacePreparation()
    this.flyover.destroy()
    this.dialogs.destroy()
    this.updateCheckGeneration++
    this.updateCheckPending = false
    this.availableUpdate = null
    this.lastUpdateCheckAt = Number.NEGATIVE_INFINITY
    this.previousOverlayType = 'none'
    this.previousSnapshot = undefined
    this.editorDiagnosticsMemo.clear()
    this.noticeGeneration++
    for (const timer of this.noticeTimers) clearTimeout(timer)
    this.noticeTimers.clear()
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

  private async exportTrackFile(track: Track, creatorChallenge?: CreatorGhostChallenge): Promise<void> {
    const generation = this.noticeGeneration
    try {
      if (await exportTrack(track, creatorChallenge)) this.showRaceExportNotice('Track file saved.', generation)
    } catch (error) {
      console.error('Track Forge track export failed:', error)
      this.showRaceExportNotice('Export failed. Please try another save location.', generation)
    }
  }

  private async exportRaceDiagnostics(): Promise<void> {
    const generation = this.noticeGeneration
    const report = this.runtime.raceSession.diagnosticsReport?.()
    if (!report) {
      this.showRaceExportNotice('Race replay is no longer available.')
      return
    }
    const filename = raceDiagnosticsFilename(report.track.name, new Date().toISOString())
    try {
      const saved = await saveJsonFile({
        filename,
        content: JSON.stringify({ ...report, performance: this.runtime.frameDiagnostics?.() ?? null }),
      })
      this.showRaceExportNotice(saved ? 'Race replay file saved.' : 'Race replay was not saved.', generation)
    } catch (error) {
      console.error('Track Forge race replay export failed:', error)
      this.showRaceExportNotice('Race export failed. Please try another save location.', generation)
    }
  }

  private showRaceExportNotice(message: string, generation = this.noticeGeneration): void {
    // A previous mount's pending export must not post into a new session.
    if (!this.mounted || generation !== this.noticeGeneration) return
    const toast = createToast(message)
    this.root.append(toast)
    const timer = setTimeout(() => {
      this.noticeTimers.delete(timer)
      toast.remove()
    }, 5000)
    this.noticeTimers.add(timer)
  }

  private async downloadNearbyDiagnostics(nearby: NearbyRace, fromResults = false): Promise<boolean> {
    const capturedAt = new Date().toISOString()
    // Capture the local frame report and JS network counters before any async work.
    // The results overlay can remain visible while the next round is being prepared.
    const performance = fromResults && nearby.snapshot().phase === 'racing' &&
      this.runtime.raceSession.snapshot().setup?.mode === 'nearby'
      ? this.runtime.frameDiagnostics?.() ?? null : null
    const network = await nearby.diagnostics()
    let storage: Record<string, unknown>
    try {
      const estimate = await navigator.storage?.estimate?.()
      storage = estimate ? { status: 'available', usageBytes: estimate.usage ?? null, quotaBytes: estimate.quota ?? null }
        : { status: 'unavailable' }
    } catch (error) {
      console.error('Could not estimate browser storage.', error)
      storage = { status: 'failed' }
    }
    const report = { capturedAt, ...network, performance, storage }
    const timestamp = capturedAt.replace(/[:.]/g, '-')
    return saveJsonFile({ filename: `trackforge-nearby-${timestamp}.json`, content: JSON.stringify(report, null, 2) })
  }

  private openTrackShare(track: Track, challengeOverride?: CreatorGhostChallenge): void {
    if (isSeededTrack(track)) {
      this.showRaceExportNotice('Built-in tracks are already available to every player.')
      return
    }
    const current = this.controller.snapshot()
    const setup = {
      car: current.preferences.car,
      difficulty: current.preferences.difficulty,
      laps: track.routeKind === 'point-to-point' ? 1 : current.preferences.raceLaps ?? 2,
    }
    const challenge = challengeOverride ?? this.runtime.raceSession.creatorGhostChallenge?.(track, setup) ?? undefined
    this.controller.dispatch({ type: 'open-track-share', track, challenge })
  }

  private async shareTrackChallenge(track: Track, creatorChallenge?: CreatorGhostChallenge): Promise<void> {
    const generation = this.noticeGeneration
    const best = this.controller.snapshot().scoresByTrack[track.id]?.[0]
    const challenge = creatorChallenge
      ? `Race "${track.name}" in Track Forge: ${creatorChallenge.laps} ${creatorChallenge.laps === 1 ? 'lap' : 'laps'}, Ghost Race against my ${CAR_SPECS[creatorChallenge.car].name} ghost (${formatRaceTime(creatorChallenge.time)}). Import the attached track file to play.`
      : `Race "${track.name}" in Track Forge. ${best ? `Beat my ${formatRaceTime(best.time)}!` : 'Can you win?'} Import the attached track file to play.`
    try {
      if (await shareTrack(track, challenge, creatorChallenge)) return
    } catch (error) {
      // Native sharing can fail without canceling a fallback track export.
      console.error('Track Forge share failed:', error)
    }
    if (!this.mounted || generation !== this.noticeGeneration) return
    await this.exportTrackFile(track, creatorChallenge)
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
    this.root.dataset.graphicsQuality = state.preferences.graphicsQuality ?? 'medium'
    const previous = this.previousSnapshot
    this.previousSnapshot = state
    if (isSceneryRotationPreviewOnly(previous, state) || deferEditorDragChrome(previous, state)) return
    if (state.mode !== 'editor') this.editorDiagnosticsMemo.clear()
    this.screenCleanup?.()
    this.screenCleanup = undefined
    this.overlayCleanup?.()
    this.overlayCleanup = undefined
    this.materialCleanup?.()
    this.materialCleanup = undefined
    if (
      state.overlay.type !== 'race-setup' ||
      this.racePreparation?.track !== state.currentTrack ||
      this.racePreparation?.lighting !== (state.raceLighting ?? state.currentTrack?.lighting)
    ) {
      this.cancelRacePreparation()
    }
    const isRaceSetup = state.overlay.type === 'race-setup' ||
      (state.overlay.type === 'options' && state.overlay.returnTo === 'race-setup')
    const lobbyTrack = state.overlay.type === 'nearby' ? this.runtime.nearby?.snapshot().lobbyTrack : undefined
    const flyoverKey = isRaceSetup && state.currentTrack ? 'solo:' + state.currentTrack.id
      : lobbyTrack ? 'nearby:' + lobbyTrack.id : undefined
    this.flyover.begin(flyoverKey)
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
            cup: () => this.controller.dispatch({ type: 'open-cup' }),
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
              previewSceneryRotation: (target, rotation) =>
                this.controller.dispatch({ type: 'preview-scenery-rotation', target, rotation }),
              edit: (command) =>
                this.controller.dispatch({ type: 'editor', command }),
            }, geometry, this.editorDiagnosticsMemo)
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
    // Rebuilding a sorted library after starring a card must not jump back to the top.
    const libraryScroll = state.overlay.type === 'track-library' && this.previousOverlayType === 'track-library'
      ? this.root.querySelector<HTMLElement>('.track-library-modal .modal-body')?.scrollTop
      : undefined
    // Preserve the current view while visiting race setup, not on a fresh visit.
    const returningThroughSetup = state.mode === 'home' && (
      state.overlay.type === 'race-setup' ||
      (state.overlay.type === 'options' && state.overlay.returnTo === 'race-setup') ||
      (state.overlay.type === 'track-library' && state.overlay.purpose === 'race' && this.previousOverlayType === 'race-setup')
    )
    const returningThroughShare = (state.overlay.type === 'track-share' && state.overlay.returnTo.type === 'track-library') ||
      (state.overlay.type === 'nearby' && state.overlay.shareReturnTo?.type === 'track-library') ||
      (state.overlay.type === 'track-library' && (this.previousOverlayType === 'track-share' || this.previousOverlayType === 'nearby'))
    const currentLibrary = this.previousOverlayType === 'track-library' &&
      (state.overlay.type === 'track-library' || returningThroughSetup || returningThroughShare)
      ? this.root.querySelector<HTMLElement>('.track-library-modal')
      : null
    const librarySearch = currentLibrary?.querySelector<HTMLInputElement>('[aria-label="Search tracks"]')
    if (currentLibrary) {
      this.trackLibraryViewState = {
        searchQuery: librarySearch?.value ?? '',
        searchOpen: librarySearch ? !librarySearch.hidden : false,
        filter: currentLibrary.querySelector<HTMLButtonElement>('[data-action="library-filter-favorites"]')?.getAttribute('aria-pressed') === 'true'
          ? 'favorites'
          : 'all',
      }
    } else if (!returningThroughSetup && !returningThroughShare) this.trackLibraryViewState = undefined
    // Keep the local player's scroll and diagnostic export across roster updates.
    const previousLobby = lobbyTrack && this.previousOverlayType === 'nearby'
      ? this.root.querySelector<HTMLElement>('.nearby-lobby-modal') : null
    const lobbyScroll = previousLobby?.querySelector<HTMLElement>('.modal-body')?.scrollTop
    const diagnostics = previousLobby?.querySelector<HTMLDetailsElement>('.nearby-lobby-diagnostics')
    const overlay = this.renderOverlay(state)
    // Lighting changes rebuild this modal. Carry only this interaction into
    // the new button, not into a different track or a fresh visit.
    if (previous?.overlay.type === 'race-setup' && state.overlay.type === 'race-setup' &&
        previous.currentTrack?.id === state.currentTrack?.id &&
        (previous.raceLighting ?? previous.currentTrack?.lighting ?? 'day') !==
          (state.raceLighting ?? state.currentTrack?.lighting ?? 'day')) {
      const lightingToggle = overlay?.querySelector<HTMLButtonElement>('.lighting-toggle')
      if (lightingToggle) lightingToggle.dataset.lightingTransition = 'true'
    }
    if (diagnostics && overlay?.classList.contains('nearby-lobby-modal')) {
      overlay.querySelector('.nearby-lobby-diagnostics')?.replaceWith(diagnostics)
    }
    this.flyover.end()
    const nodes: Node[] = [screen]
    if (overlay) nodes.push(overlay)
    if (state.notice && state.overlay.type !== 'track-name' && state.overlay.type !== 'editor-exit') {
      nodes.push(createToast(state.notice))
    }
    this.root.replaceChildren(...nodes)
    this.materialCleanup = !overlay && state.mode === 'editor'
      ? attachEditorGlass(this.root, screen)
      : attachMenuGlass(this.root, overlay ?? (state.mode === 'home' ? screen : undefined))
    const scroll = libraryScroll ?? lobbyScroll
    if (scroll !== undefined) {
      const body = overlay?.querySelector<HTMLElement>('.modal-body')
      if (body) body.scrollTop = scroll
    }
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
      case 'track-share': {
        const { track, challenge } = state.overlay
        const nearby = this.runtime.nearby
        const frame = createModalFrame('Share track', track.name, close, 'track-share-modal')
        const ghost = challenge ?? track.creatorChallenge
        frame.body.classList.add('menu-buttons')
        frame.body.append(element('p', 'modal-subtitle', ghost
          ? `Ghost included · ${CAR_SPECS[ghost.car].name} · ${formatRaceTime(ghost.time)} · ${ghost.laps} ${ghost.laps === 1 ? 'lap' : 'laps'}`
          : 'No saved ghost for this track and race setup.'))
        frame.body.append(element('p', 'modal-subtitle', 'Both options include a signed, read-only track file.'))
        const send = button('NEARBY', 'share-nearby', () =>
          this.controller.dispatch({ type: 'send-nearby-track', track, challenge }), 'button button-primary')
        send.disabled = !nearby || nearby.snapshot().phase !== 'idle'
        frame.body.append(send)
        if (send.disabled) frame.body.append(element('p', 'modal-subtitle', 'Nearby is unavailable right now.'))
        frame.body.append(button('EXPORT', 'share-export', () => {
          close()
          void this.shareTrackChallenge(track, challenge)
        }, 'button'))
        frame.footer.append(button('CANCEL', 'share-cancel', close, 'button'))
        return frame.overlay
      }
      case 'nearby': {
        const nearby = this.runtime.nearby
        if (!nearby) return undefined
        if (state.overlay.confirmLeave) return createNearbyLeaveConfirmation(nearby.snapshot().role, {
          stay: close,
          leave: () => this.controller.dispatch({ type: 'leave-nearby' }),
        })
        const lobby = nearby.snapshot()
        const track = lobby.lobbyTrack
        const geometry = track && this.runtime.geometry.get(track)
        const flyover = track && geometry && geometry.path.points.length > 1
          ? this.flyover.get(track, geometry, lobby.localCar, lobby.lighting ?? track.lighting, false)
          : undefined
        return createNearbyRaceModal(nearby, {
          close,
          downloadDiagnostics: () => this.downloadNearbyDiagnostics(nearby),
          chooseTrack: () => this.controller.dispatch({ type: 'open-track-library', purpose: 'nearby-host' }),
          configureCup: () => this.controller.dispatch({ type: 'open-cup' }),
          scan: () => this.controller.dispatch({ type: 'scan-nearby' }),
          connectByIp: (ip) => nearby.connectByIp(ip),
          scanTracks: () => this.controller.dispatch({ type: 'scan-nearby-track' }),
          saveTrack: () => this.controller.dispatch({ type: 'save-nearby-track' }),
          declineTrack: () => this.controller.dispatch({ type: 'decline-nearby-track' }),
        }, this.runtime.nearbyConnections, flyover)
      }
      case 'cup':
        return createCupModal(state, {
          close,
          addTrack: () => this.controller.dispatch({ type: 'cup-add-track' }),
          loadCurated: () => this.controller.dispatch({ type: 'cup-load-curated' }),
          removeTrack: (index) => this.controller.dispatch({ type: 'cup-remove-track', index }),
          moveTrack: (index, direction) => this.controller.dispatch({ type: 'cup-move-track', index, direction }),
          start: () => this.controller.dispatch({ type: 'start-cup' }),
          resume: () => this.controller.dispatch({ type: 'resume-cup' }),
          ...(this.runtime.nearby ? { hostNearby: () => this.controller.dispatch({ type: 'host-nearby-cup' }) } : {}),
        })
      case 'cup-final':
        return state.cup ? createCupFinalModal(state.cup, () => this.controller.dispatch({ type: 'next-cup-race' }), state.preferences.displayName) : undefined
      case 'results': {
        const result = this.runtime.raceSession.snapshot().result
        if (!result) return undefined
        const nearby = this.runtime.nearby
        if (result.mode === 'nearby' && nearby) {
          const results = createNearbyRaceResults(nearby, result, {
            leave: () => this.controller.dispatch({ type: 'leave-nearby' }),
            race: () => this.controller.dispatch({ type: 'nearby-race-again' }),
            selectTrack: () => this.controller.dispatch({ type: 'nearby-select-next-track' }),
            downloadDiagnostics: () => this.downloadNearbyDiagnostics(nearby, true),
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
          shareChallengeResult: (() => {
            const { track, setup } = this.runtime.raceSession.snapshot()
            if (track?.origin !== 'imported' || !track.creatorChallenge ||
                isSeededTrack(track) || setup?.mode !== 'ghost') return undefined
            const challenge = this.runtime.raceSession.creatorGhostChallenge?.(track, setup, true)
            return challenge ? () => this.openTrackShare(track, challenge) : undefined
          })(),
          changeTrack: () => this.controller.dispatch({ type: 'open-track-library', purpose: 'race' }),
          edit: () => this.controller.dispatch({ type: 'open-editor' }),
          home: () => this.controller.dispatch({ type: 'go-home' }),
        }, state.cup ? { cup: state.cup, next: () => this.controller.dispatch({ type: 'next-cup-race' }) } : undefined, state.newTimeMedal, state.preferences.displayName)
        const standings = modal.querySelector<HTMLElement>('[data-results-standings]')
        if (standings && result.rivalsFinishing) {
          let previous = result
          this.overlayCleanup = this.runtime.raceSession.subscribe(({ result: next }) => {
            if (!next || next === previous) return
            previous = next
            updateStandings(standings, next.standings, next.rivalsFinishing, state.preferences.displayName)
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
          toggleFavorite: (id) => this.controller.dispatch({ type: 'toggle-track-favorite', id }),
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
          share: (track) => this.openTrackShare(track),
          importFile: (content) => this.controller.dispatch({ type: 'import-track', content }),
          delete: (track) => {
            if (this.environment.confirm(`Delete "${track.name}"?`)) {
              this.controller.dispatch({
                type: 'delete-track',
                id: track.id,
              })
            }
          },
        }, this.runtime.geometry, this.trackLibraryViewState)
      case 'player-name':
        return createPlayerNameModal(state, (name) =>
          this.controller.dispatch({ type: 'set-player-name', name }))
      case 'track-name':
        return createNameModal(state, {
          close,
          submit: (name) =>
            this.controller.dispatch({
              type:
                state.overlay.type === 'track-name' && state.overlay.purpose === 'rename'
                  ? 'rename-track'
                  : state.overlay.type === 'track-name' && state.overlay.purpose === 'save-as'
                    ? 'save-as-track'
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
        } as const
        const availability = currentTrack
          ? this.runtime.raceSession.ghostAvailability?.(currentTrack, ghostSetup) ??
            (() => { const time = this.runtime.raceSession.ghostTime?.(currentTrack, ghostSetup); return time == null ? { kind: 'none' as const } : { kind: 'exact' as const, time } })()
          : { kind: 'none' as const }
        const ghostTime = availability.kind === 'exact' ? availability.time : null
        const geometry = currentTrack && this.runtime.geometry.get(currentTrack)
        const flyover = currentTrack && geometry && geometry.path.points.length > 1
          ? this.flyover.get(
              currentTrack,
              geometry,
              preferences.car,
              lighting,
              preferences.raceMode === 'ghost' && ghostTime !== null && Number.isFinite(ghostTime) && ghostTime > 0,
            )
          : undefined
        if (currentTrack && geometry && flyover && !this.racePreparation) {
          const cancel = this.runtime.prepareRace?.(currentTrack, geometry, lighting)
          if (cancel) this.racePreparation = { track: currentTrack, lighting, cancel }
        }
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
        }, availability, flyover, currentTrack ? this.runtime.raceSession.ghostSetups?.(currentTrack) : undefined)
      }
      case 'options':
        return createOptionsModal(state, {
          close,
          previewVolume: (setting, volume) => this.runtime.previewAudioVolume?.(setting, volume),
          playerName: (name) => this.controller.dispatch({ type: 'set-player-name', name }),
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
      case 'editor-exit':
        return createEditorExitModal({
          save: () => this.controller.dispatch({ type: 'resolve-editor-exit', choice: 'save' }),
          saveAs: () => this.controller.dispatch({ type: 'resolve-editor-exit', choice: 'save-as' }),
          discard: () => this.controller.dispatch({ type: 'resolve-editor-exit', choice: 'discard' }),
          cancel: () => this.controller.dispatch({ type: 'resolve-editor-exit', choice: 'cancel' }),
        }, state.notice)
      case 'editor-menu':
        return createEditorMenuModal(state.currentTrack?.name ?? 'NO TRACK', state.editor.environmentId, state.editor.routeKind, {
          close,
          setRouteKind: (routeKind) =>
            this.controller.dispatch({ type: 'editor', command: { type: 'set-route-kind', routeKind } }),
          setEnvironment: (environmentId) =>
            this.controller.dispatch({
              type: 'editor',
              command: { type: 'set-environment', environmentId },
            }),
          share: () => {
            const track = this.controller.snapshot().currentTrack
            if (track) this.openTrackShare(track)
          },
          save: () =>
            this.controller.dispatch({ type: 'save-current-track' }),
          race: () =>
            this.controller.dispatch({ type: 'race-current-track' }),
          saveAs: () =>
            this.controller.dispatch({ type: 'open-track-name', purpose: 'save-as' }),
          rename: () =>
            this.controller.dispatch({
              type: 'open-track-name',
              purpose: 'rename',
            }),
          home: () => this.controller.dispatch({ type: 'go-home' }),
        }, isSharedTrack(state.currentTrack))
    }
  }
}
