import type Phaser from 'phaser'
import type { RaceEffectsState, RaceParticle } from '@/domain/race/effects'

const TEXTURE_KEY = 'trackforge-round-particle'
const COLORS = {
  dirt: 0xb78553, grass: 0x89ad67, ice: 0xebfaff,
  'tire-smoke': 0xb9c0c8, 'landing-dust': 0xa6afb9,
} as const

/** Feed each live emission to Phaser once, including emissions from skipped simulation ticks. */
export class ParticleEmissionCursor {
  private seen = new Set<number>()

  update(effects: RaceEffectsState): readonly RaceParticle[] {
    const next = new Set<number>()
    const births: RaceParticle[] = []
    for (const particle of effects.particles) {
      const id = particle.emissionId
      if (id === undefined || particle.kind === 'speed-line') continue
      next.add(id)
      if (!this.seen.has(id)) births.push(particle)
    }
    this.seen = next
    return births
  }
}

interface Appearance {
  readonly scale: number
  readonly alpha: number
  readonly age: number
}

/** Phaser owns particle pooling, motion, fading and expiry. The simulation still
 * supplies deterministic spawn descriptors (and consumes the same random draws). */
export class NativeRaceParticles {
  private readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter
  private readonly cursor = new ParticleEmissionCursor()
  private readonly appearance = new WeakMap<Phaser.GameObjects.Particles.Particle, Appearance>()
  private pending: Appearance = { scale: 1, alpha: 1, age: 0 }
  private tick: number | undefined

  constructor(scene: Phaser.Scene, depth: number) {
    if (!scene.textures.exists(TEXTURE_KEY)) {
      const texture = scene.textures.createCanvas(TEXTURE_KEY, 16, 16)
      if (!texture) throw new Error('Could not create race particle texture')
      texture.context.fillStyle = '#ffffff'
      texture.context.beginPath()
      texture.context.arc(8, 8, 8, 0, Math.PI * 2)
      texture.context.fill()
      texture.refresh()
    }
    this.emitter = scene.add.particles(0, 0, TEXTURE_KEY, {
      emitting: false, maxParticles: 180, speed: 0,
      scale: {
        onEmit: particle => {
          this.appearance.set(particle, this.pending)
          return this.pending.scale * (1 + 0.8 * this.pending.age)
        },
        onUpdate: (particle, _key, t, value) => {
          const item = this.appearance.get(particle)
          return item ? item.scale * (1 + 0.8 * (item.age + (1 - item.age) * t)) : value
        },
      },
      alpha: {
        onEmit: () => this.pending.alpha,
        onUpdate: (particle, _key, t, value) => {
          const item = this.appearance.get(particle)
          return item ? item.alpha * (1 - t) : value
        },
      },
    }).setDepth(depth).setActive(false)
  }

  render(effects: RaceEffectsState, tick: number): void {
    // Advance from the fixed-step clock rather than wall time; pause and
    // repeated presentation frames must not age particles.
    if (this.tick !== undefined && tick > this.tick) {
      this.emitter.preUpdate(0, (tick - this.tick) * 1000 / 60)
    }
    this.tick = tick
    for (const item of this.cursor.update(effects)) {
      if (item.kind === 'speed-line') continue
      this.pending = {
        scale: item.size / 8,
        alpha: item.life / item.maxLife * (item.kind === 'landing-dust' ? 0.6 : 1),
        age: 1 - item.life / item.maxLife,
      }
      this.emitter.setParticleLifespan(item.life * 1000)
      this.emitter.setParticleTint(COLORS[item.kind])
      const particle = this.emitter.emitParticleAt(item.x, item.y, 1)
      if (particle) {
        particle.velocityX = item.vx
        particle.velocityY = item.vy
      }
    }
  }

  destroy(): void { this.emitter.destroy() }
}
