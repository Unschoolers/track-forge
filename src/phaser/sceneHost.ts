import Phaser from 'phaser'
import type { AppMode, SceneHost } from '@/app/createApplication'
import { BootScene } from '@/phaser/scenes/BootScene'
import {
  EditorScene,
  type SceneControllerPort,
} from '@/phaser/scenes/EditorScene'
import { RaceScene } from '@/phaser/scenes/RaceScene'
import type { RaceSessionPort } from '@/application/race/raceSession'
import type { RaceControlsPort } from '@/application/ports/input'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'

export class PhaserSceneHost implements SceneHost {
  private game: Phaser.Game | undefined
  private mode: AppMode = 'home'

  constructor(
    private readonly parent: HTMLElement,
    private readonly controller: SceneControllerPort,
    private readonly raceSession: RaceSessionPort,
    private readonly raceControls: RaceControlsPort,
    private readonly geometry: TrackGeometryService,
  ) {}

  start(mode: AppMode): void {
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
          ),
        ],
        input: { activePointers: 3 },
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      })
      return
    }
    if (modeChanged) this.syncScene()
  }

  destroy(): void {
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
