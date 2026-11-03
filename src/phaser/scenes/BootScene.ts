import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#2d7344')
  }
}
