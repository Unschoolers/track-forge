import Phaser from 'phaser'
import type { GraphicsQuality } from '@/application/ports/storage'

const BURSTS = [
  { delay: 0, x: 0.17, y: 0.24 },
  { delay: 180, x: 0.83, y: 0.28 },
  { delay: 540, x: 0.27, y: 0.70 },
  { delay: 720, x: 0.75, y: 0.66 },
  { delay: 1150, x: 0.13, y: 0.38 },
  { delay: 1300, x: 0.87, y: 0.36 },
] as const

function sparkTexture(scene: Phaser.Scene, key: string, color: string): string {
  const texture = scene.textures.createCanvas(key, 24, 24)
  if (!texture) throw new Error('Could not create victory firework texture: ' + key)
  const ctx = texture.context
  // Canvas particles use precolored textures; their renderer does not apply tint.
  const glow = ctx.createRadialGradient(12, 12, 0, 12, 12, 12)
  glow.addColorStop(0, '#fffdf4')
  glow.addColorStop(0.22, color)
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 24, 24)
  ctx.fillStyle = '#fffdf4'
  ctx.beginPath()
  ctx.moveTo(12, 2); ctx.lineTo(14, 10); ctx.lineTo(21, 12); ctx.lineTo(14, 14)
  ctx.lineTo(12, 22); ctx.lineTo(10, 14); ctx.lineTo(3, 12); ctx.lineTo(10, 10)
  ctx.closePath()
  ctx.fill()
  texture.refresh()
  return key
}

/** A bounded, transparent Canvas scene above the race and behind the medal text. */
export function playVictoryFireworks(host: HTMLElement, quality: GraphicsQuality): () => void {
  const width = Math.min(720, host.clientWidth)
  const height = Math.min(320, host.clientHeight)
  if (width <= 0 || height <= 0) return () => undefined
  const low = quality === 'low'
  const high = quality === 'high'
  const count = low ? 15 : high ? 34 : 26
  const speed = Math.min(width, height * 1.8)
  let disposed = false
  let game: Phaser.Game | undefined
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    game?.destroy(true)
  }
  game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent: host,
    width, height,
    transparent: true,
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    scale: { mode: Phaser.Scale.NONE },
    scene: {
      create(this: Phaser.Scene): void {
        if (disposed) return
        const gold = this.add.particles(0, 0, sparkTexture(this, 'victory-gold', '#ffbc44'), {
          emitting: false, maxAliveParticles: count * 3,
          angle: { min: 0, max: 360 },
          speed: { min: speed * 0.20, max: speed * 0.65 },
          gravityY: speed * 0.36,
          lifespan: { min: 650, max: 1200 },
          scale: { start: 0.55, end: 0.06 },
          alpha: { start: 0.95, end: 0 },
          rotate: { min: 0, max: 360 },
        })
        const silver = this.add.particles(0, 0, sparkTexture(this, 'victory-ice', '#9bdfff'), {
          emitting: false, maxAliveParticles: count * 2,
          angle: { min: 0, max: 360 },
          speed: { min: speed * 0.10, max: speed * 0.42 },
          gravityY: speed * 0.20,
          lifespan: { min: 800, max: 1500 },
          scale: { start: 0.32, end: 0.04 },
          alpha: { start: 0.85, end: 0 },
          rotate: { min: 0, max: 360 },
        })
        const burst = (x: number, y: number): void => {
          gold.explode(count, width * x, height * y)
          silver.explode(Math.ceil(count / 3), width * x, height * y)
        }
        for (const wave of BURSTS) {
          if (wave.delay === 0) burst(wave.x, wave.y)
          else this.time.delayedCall(wave.delay, () => burst(wave.x, wave.y))
        }
        this.time.delayedCall(3000, dispose)
      },
    },
  })
  if (disposed) game.destroy(true)
  return dispose
}
