import Phaser from 'phaser'
import type { AppMode, SceneHost } from '@/app/createApplication'
import { BootScene } from '@/phaser/scenes/BootScene'
import {
  EditorScene,
  type SceneControllerPort,
} from '@/phaser/scenes/EditorScene'
import { RaceScene } from '@/phaser/scenes/RaceScene'
import type { RaceFrameDiagnostics } from '@/infrastructure/qa/raceFrameDiagnostics'
import type { RacePerformance } from '@/infrastructure/qa/racePerformance'
import type { RaceSessionPort } from '@/application/race/raceSession'
import type { RaceControlsPort } from '@/application/ports/input'
import type { LightingMode, Track } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { normalizeTrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { prepareRaceAtlas } from '@/phaser/rendering/raceBitmapAtlas'
import { RacePresentationPreparation } from '@/phaser/rendering/racePresentationPreparation'
import { graphicsPixelRatio, backingSize } from '@/phaser/rendering/graphicsQuality'

export class PhaserSceneHost implements SceneHost {
  private game: Phaser.Game | undefined
  private mode: AppMode = 'home'
  private raceTrackId: string | undefined
  private raceRunId: number | undefined
  private raceLighting: string | undefined
  private readonly racePreparation = new RacePresentationPreparation()
  private racePixelRatio = 1
  private resizeObserver: ResizeObserver | undefined

  constructor(
    private readonly parent: HTMLElement,
    private readonly controller: SceneControllerPort,
    private readonly raceSession: RaceSessionPort,
    private readonly raceControls: RaceControlsPort,
    private readonly geometry: TrackGeometryService,
    private readonly racePerformance?: RacePerformance,
    private readonly frameDiagnostics?: RaceFrameDiagnostics,
    private readonly onRacePresented?: (runId: number | undefined) => void,
  ) {}

  start(mode: AppMode): void {
    if (mode === 'race') this.racePreparation.cancel()
    const modeChanged = this.mode !== mode
    this.mode = mode
    if (!this.game) {
      const initial = backingSize(this.parent.clientWidth || 1024, this.parent.clientHeight || 768, 1)
      this.game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: this.parent,
        width: initial.width,
        height: initial.height,
        backgroundColor: '#2d7344',
        scene: [
          new BootScene(),
          new EditorScene(this.controller, this.geometry),
          new RaceScene(
            this.controller,
            this.raceSession,
            this.raceControls,
            this.geometry,
            this.racePerformance,
            this.frameDiagnostics,
            () => this.racePixelRatio,
            this.onRacePresented,
          ),
        ],
        input: { activePointers: 3 },
        scale: {
          // CSS owns display size; resize the backing buffer explicitly.
          mode: Phaser.Scale.NONE,
        },
      })
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(this.resizeCanvas)
        this.resizeObserver.observe(this.parent)
      }
      window.addEventListener('resize', this.resizeCanvas)
      const frameDiagnostics = this.frameDiagnostics
      if (frameDiagnostics) {
        this.game.events.on(Phaser.Core.Events.PRE_RENDER, () => frameDiagnostics.beginRender())
        this.game.events.on(Phaser.Core.Events.POST_RENDER, (_renderer: unknown, time: number) => {
          const state = this.raceSession.snapshot().state
          frameDiagnostics.afterRender(time, state?.tick ?? 0, state?.phase === 'running' && !state.paused)
        })
      }
      const racePerformance = this.racePerformance
      if (racePerformance) {
        this.game.events.on(Phaser.Core.Events.PRE_RENDER, () => racePerformance.beginRender())
        this.game.events.on(Phaser.Core.Events.POST_RENDER, (_renderer: unknown, time: number) => {
          racePerformance.afterRender(time, this.raceSession.snapshot())
        })
      }
      return
    }
    const trackId = mode === 'race' ? this.controller.snapshot().currentTrack?.id : undefined
    const race = mode === 'race' ? this.raceSession.snapshot() : undefined
    const lighting = race?.setup?.lighting
    // A new run of the same circuit needs a fresh scene so Nearby can arm its countdown.
    const sceneChanged = mode === 'race' && (trackId !== this.raceTrackId ||
      lighting !== this.raceLighting || race?.runId !== this.raceRunId)
    this.raceLighting = lighting
    this.raceTrackId = trackId
    this.raceRunId = race?.runId
    if (modeChanged || sceneChanged) {
      this.racePixelRatio = mode === 'race'
        ? graphicsPixelRatio(this.controller.snapshot().preferences?.graphicsQuality, window.devicePixelRatio)
        : 1
      this.resizeCanvas()
    }
    if (modeChanged) this.syncScene()
    else if (sceneChanged) {
      this.game.scene.stop('RaceScene')
      this.game.scene.start('RaceScene')
    }
  }

  private readonly resizeCanvas = (): void => {
    const game = this.game
    if (!game?.isRunning) return
    const width = this.parent.clientWidth
    const height = this.parent.clientHeight
    if (width <= 0 || height <= 0) return
    const size = backingSize(width, height, this.racePixelRatio)
    if (game.scale.width !== size.width || game.scale.height !== size.height) {
      game.scale.resize(size.width, size.height)
    }
  }

  whenReady(): Promise<void> {
    const game = this.game
    if (!game) throw new Error('Phaser must start before waiting for it to be ready')
    if (game.isRunning) return Promise.resolve()
    return new Promise((resolve) => game.events.once(Phaser.Core.Events.READY, resolve))
  }

  prepareRace(track: Track, geometry: TrackGeometry, lighting: LightingMode): () => void {
    const game = this.game
    return this.racePreparation.prepare(
      geometry,
      normalizeTrackEnvironmentId(track.environmentId),
      lighting === 'night',
      game?.isRunning ? { textures: game.textures, width: game.scale.width, height: game.scale.height, lowQuality: this.controller.snapshot().preferences?.graphicsQuality === 'low', atlasTextures: game.textures } : undefined,
    )
  }

  async prepareStartupRace(track: Track, lighting: LightingMode, report: (progress: number) => void): Promise<void> {
    const game = this.game
    if (!game?.isRunning) throw new Error('Phaser must be ready before race atlas preparation')
    const nextPaint = () => new Promise<void>(resolve => {
      window.requestAnimationFrame(() => { window.setTimeout(resolve, 0) })
    })
    report(0)
    await nextPaint()
    const work = prepareRaceAtlas(game.textures, this.geometry.get(track), lighting === 'night', normalizeTrackEnvironmentId(track.environmentId))
    let deadline = performance.now() + 8
    for (const progress of work) {
      report(progress)
      if (performance.now() >= deadline) {
        await nextPaint()
        deadline = performance.now() + 8
      }
    }
    report(1)
  }

  setRacePreparationForeground(foreground: boolean): void {
    this.racePreparation.setForeground(foreground)
  }

  /** Read-only camera position for the browser gameplay harness. */
  editorCameraSnapshot(): { x: number; y: number; zoom: number } | null {
    if (!this.game?.scene.isActive('EditorScene')) return null
    const scene = this.game.scene.getScene('EditorScene')
    return scene instanceof EditorScene ? scene.cameraSnapshot() : null
  }

  destroy(): void {
    this.racePreparation.cancel()
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined
    window.removeEventListener('resize', this.resizeCanvas)
    this.game?.destroy(true)
    this.game = undefined
  }

  private syncScene(): void {
    if (!this.game) return
    if (this.mode === 'editor') {
      this.game.scene.stop('BootScene')
      this.game.scene.stop('RaceScene')
      this.game.scene.start('EditorScene')
    } else if (this.mode === 'race') {
      this.game.scene.stop('BootScene')
      this.game.scene.stop('EditorScene')
      this.game.scene.start('RaceScene')
    } else {
      this.game.scene.stop('EditorScene')
      this.game.scene.stop('RaceScene')
      if (!this.game.scene.isActive('BootScene')) this.game.scene.start('BootScene')
    }
  }
}
