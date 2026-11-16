import Phaser from 'phaser'
import type { AppMode, SceneHost } from '@/app/createApplication'
import { BootScene } from '@/phaser/scenes/BootScene'
import {
  EditorScene,
  type SceneControllerPort,
} from '@/phaser/scenes/EditorScene'
import { RaceScene } from '@/phaser/scenes/RaceScene'
import type { RacePerformance } from '@/infrastructure/qa/racePerformance'
import type { RaceSessionPort } from '@/application/race/raceSession'
import type { RaceControlsPort } from '@/application/ports/input'
import type { LightingMode, Track } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { normalizeTrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { RacePresentationPreparation } from '@/phaser/rendering/racePresentationPreparation'

export class PhaserSceneHost implements SceneHost {
  private game: Phaser.Game | undefined
  private mode: AppMode = 'home'
  private raceTrackId: string | undefined
  private raceLighting: string | undefined
  private readonly racePreparation = new RacePresentationPreparation()

  constructor(
    private readonly parent: HTMLElement,
    private readonly controller: SceneControllerPort,
    private readonly raceSession: RaceSessionPort,
    private readonly raceControls: RaceControlsPort,
    private readonly geometry: TrackGeometryService,
    private readonly racePerformance?: RacePerformance,
  ) {}

  start(mode: AppMode): void {
    if (mode === 'race') this.racePreparation.cancel()
    const modeChanged = this.mode !== mode
    this.mode = mode
    if (!this.game) {
      this.game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: this.parent,
        width: 1024,
        height: 768,
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
          ),
        ],
        input: { activePointers: 3 },
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      })
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
    const lighting = mode === 'race' ? this.raceSession.snapshot().setup?.lighting : undefined
    const trackChanged = mode === 'race' && (trackId !== this.raceTrackId || lighting !== this.raceLighting)
    this.raceLighting = lighting
    this.raceTrackId = trackId
    if (modeChanged) this.syncScene()
    else if (trackChanged) {
      this.game.scene.stop('RaceScene')
      this.game.scene.start('RaceScene')
    }
  }

  prepareRace(track: Track, geometry: TrackGeometry, lighting: LightingMode): () => void {
    const game = this.game
    return this.racePreparation.prepare(
      geometry,
      normalizeTrackEnvironmentId(track.environmentId),
      lighting === 'night',
      game?.isRunning ? { textures: game.textures, width: game.scale.width, height: game.scale.height } : undefined,
    )
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
