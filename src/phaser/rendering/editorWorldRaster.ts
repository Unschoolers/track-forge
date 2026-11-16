import type Phaser from 'phaser'
import type { EditorCamera } from '@/phaser/input/editorInput'

const TEXTURE_LIMIT = 2_048
const VIEW_PADDING = 128

interface ViewBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly zoom: number
}

/** Cache static graphics until the roads or the visible area change. */
export class EditorWorldRaster {
  private texture: Phaser.GameObjects.RenderTexture | undefined
  private bounds: ViewBounds | undefined

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sources: readonly Phaser.GameObjects.Graphics[],
    private readonly depth: number,
  ) {}

  invalidate(): void {
    this.bounds = undefined
  }

  render(camera: EditorCamera, width: number, height: number, enabled: boolean): void {
    if (!enabled) {
      if (!this.texture) return
      this.texture.destroy()
      this.texture = undefined
      this.bounds = undefined
      for (const source of this.sources) source.setVisible(true)
      return
    }
    const halfWidth = width / (2 * camera.zoom)
    const halfHeight = height / (2 * camera.zoom)
    const left = camera.x - halfWidth
    const top = camera.y - halfHeight
    const previous = this.bounds
    if (previous && left >= previous.left && top >= previous.top &&
      camera.x + halfWidth <= previous.right && camera.y + halfHeight <= previous.bottom &&
      camera.zoom >= previous.zoom / 1.5 && camera.zoom <= previous.zoom * 1.5) return

    const paddedWidth = width + 2 * VIEW_PADDING
    const paddedHeight = height + 2 * VIEW_PADDING
    const resolution = Math.min(1, TEXTURE_LIMIT / Math.max(paddedWidth, paddedHeight))
    const scale = camera.zoom * resolution
    const textureWidth = Math.ceil(paddedWidth * resolution)
    const textureHeight = Math.ceil(paddedHeight * resolution)
    const x = left - VIEW_PADDING / camera.zoom
    const y = top - VIEW_PADDING / camera.zoom
    const capture = { x: -x * scale, y: -y * scale, scale }

    this.texture ??= this.scene.add.renderTexture(0, 0, 1, 1).setDepth(this.depth).setOrigin(0)
    const texture = this.texture
    texture.resize(textureWidth, textureHeight, false).setPosition(x, y).setScale(1 / scale).clear()
    for (const source of this.sources) texture.capture(source, capture)
    texture.render()
    for (const source of this.sources) source.setVisible(false)
    this.bounds = { left: x, top: y, right: x + textureWidth / scale, bottom: y + textureHeight / scale, zoom: camera.zoom }
  }
}
