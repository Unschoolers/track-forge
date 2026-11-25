import type Phaser from 'phaser'
import { CAR_IDS, type CarId } from '@/domain/model'
import { getVehicleBitmap, vehicleBitmapBounds } from '@/presentation/vehicleBitmapArt'

export interface VehicleBodyPainter {
  draw(car: CarId, x: number, y: number, angle: number, scaleX: number, scaleY: number, depth: number): boolean
}

// The race camera draws cars at tens of pixels. Prefilter the full-size
// artwork once so linear sampling in-game does not skip most source pixels.
const RACE_TEXTURE_WIDTH = 96

function makeRaceTexture(bitmap: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = RACE_TEXTURE_WIDTH
  canvas.height = Math.max(1, Math.round(RACE_TEXTURE_WIDTH * bitmap.naturalHeight / bitmap.naturalWidth))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create the race vehicle texture canvas')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

const textureKey = (car: CarId): string => `trackforge-vehicle-${car}`

/** Four shared textures, with a scene-owned pool reused across all race frames. */
export class VehicleSpriteRenderer implements VehicleBodyPainter {
  private readonly sprites: Phaser.GameObjects.Image[] = []
  private readonly available = new Set<CarId>()
  private readonly bounds = new Map(CAR_IDS.map(car => [car, vehicleBitmapBounds(car)]))
  private used = 0

  constructor(private readonly scene: Phaser.Scene, resolve = getVehicleBitmap) {
    for (const car of CAR_IDS) {
      const bitmap = resolve(car)
      if (!bitmap) continue
      const key = textureKey(car)
      if (!scene.textures.exists(key) && !scene.textures.addCanvas(key, makeRaceTexture(bitmap))) {
        throw new Error(`Could not register vehicle artwork for ${car}`)
      }
      this.available.add(car)
    }
  }

  beginFrame(): void { this.used = 0 }

  draw(car: CarId, x: number, y: number, angle: number, scaleX: number, scaleY: number, depth: number): boolean {
    if (!this.available.has(car)) return false
    const bounds = this.bounds.get(car)
    if (!bounds) throw new Error(`Missing vehicle bounds for ${car}`)
    const key = textureKey(car)
    let sprite = this.sprites[this.used]
    if (!sprite) {
      sprite = this.scene.add.image(x, y, key)
      this.sprites.push(sprite)
    }
    // Keep all bodies below their overlay graphics but above the same bridge
    // layer's shadows. Monotonic depth retains the established player-last order.
    const spriteDepth = depth - 0.1 / (this.used + 1)
    this.used++
    if (sprite.depth !== spriteDepth) sprite.setDepth(spriteDepth)
    if (sprite.texture.key !== key) sprite.setTexture(key)
    sprite.setOrigin(-bounds.x / bounds.width, 0.5)
      .setPosition(x, y).setRotation(angle)
      .setDisplaySize(bounds.width * scaleX, bounds.height * scaleY)
      .setVisible(true)
    return true
  }

  endFrame(): void {
    for (let index = this.used; index < this.sprites.length; index++) this.sprites[index]?.setVisible(false)
  }

  destroy(): void {
    for (const sprite of this.sprites.splice(0)) sprite.destroy()
    this.used = 0
  }
}
