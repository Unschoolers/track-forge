import type Phaser from 'phaser'
import type { RaceEffectsState, RaceParticle } from '@/domain/race/effects'
import { raceParticleStyle, type ParticleShape } from '@/phaser/rendering/raceParticleStyle'

/** Feed each live emission to Phaser once, including emissions from skipped simulation ticks. */
export class ParticleEmissionCursor {
  private seen = new Set<number>()

  update(effects: RaceEffectsState): readonly RaceParticle[] {
    const next = new Set<number>()
    const births: RaceParticle[] = []
    for (const particle of effects.particles) {
      const id = particle.emissionId
      if (id === undefined) continue
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
  readonly growth: number
  readonly angle: number
}

const BUDGETS = { puff: 116, debris: 40, wind: 24 } as const
const SHAPES = ['puff', 'debris', 'wind'] as const

function particleTexture(scene: Phaser.Scene, shape: ParticleShape): string {
  const key = 'trackforge-particle-' + shape
  if (scene.textures.exists(key)) return key
  const texture = scene.textures.createCanvas(key, shape === 'wind' ? 64 : 16, 16)
  if (!texture) throw new Error('Could not create race particle texture: ' + shape)
  const ctx = texture.context
  if (shape === 'puff') {
    const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8)
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.85)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 16, 16)
  } else if (shape === 'wind') {
    const gradient = ctx.createLinearGradient(0, 8, 64, 8)
    gradient.addColorStop(0, 'rgba(255,255,255,0)')
    gradient.addColorStop(0.65, '#ffffff')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 4, 64, 8)
  } else {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(1, 9); ctx.lineTo(6, 5); ctx.lineTo(15, 7); ctx.lineTo(10, 11)
    ctx.closePath(); ctx.fill()
  }
  texture.refresh()
  return key
}

/** Phaser owns pooled motion, fading and expiry. All pools together retain at most 180 particles. */
export class NativeRaceParticles {
  private readonly emitters = new Map<ParticleShape, Phaser.GameObjects.Particles.ParticleEmitter>()
  private readonly cursor = new ParticleEmissionCursor()
  private readonly appearance = new WeakMap<Phaser.GameObjects.Particles.Particle, Appearance>()
  private pending: Appearance = { scale: 1, alpha: 1, age: 0, growth: 0, angle: 0 }
  private tick: number | undefined

  constructor(scene: Phaser.Scene, depth: number, private readonly desert = false, private readonly low = false) {
    for (const shape of SHAPES) {
      const emitter = scene.add.particles(0, 0, particleTexture(scene, shape), {
        // Phaser's hard maxParticles counts dead pooled entries and blocks reuse at the cap.
        // Limit live particles instead; emitParticle reuses dead entries before allocating.
        emitting: false, maxAliveParticles: low ? Math.floor(BUDGETS[shape] / 2) : BUDGETS[shape], speed: 0,
        scale: {
          onEmit: particle => {
            if (particle) this.appearance.set(particle, this.pending)
            return this.pending.scale * (1 + this.pending.growth * this.pending.age)
          },
          onUpdate: (particle, _key, t, value) => {
            const item = this.appearance.get(particle)
            return item ? item.scale * (1 + item.growth * (item.age + (1 - item.age) * t)) : value
          },
        },
        alpha: {
          onEmit: () => this.pending.alpha,
          onUpdate: (particle, _key, t, value) => {
            const item = this.appearance.get(particle)
            return item ? item.alpha * (1 - t) : value
          },
        },
        rotate: { onEmit: () => this.pending.angle },
      }).setDepth(depth).setActive(false)
      this.emitters.set(shape, emitter)
    }
  }

  render(effects: RaceEffectsState, tick: number): void {
    // Advance from the fixed-step clock rather than wall time.
    if (this.tick !== undefined && tick > this.tick) {
      for (const emitter of this.emitters.values()) emitter.preUpdate(0, (tick - this.tick) * 1000 / 60)
    }
    this.tick = tick
    for (const item of this.cursor.update(effects)) {
      if (this.low && (item.emissionId ?? 0) % 2 !== 0) continue
      const style = raceParticleStyle(item, this.desert)
      const emitter = this.emitters.get(style.shape)
      if (!emitter) throw new Error('Missing particle emitter: ' + style.shape)
      this.pending = {
        scale: style.size / 8 * (style.shape === 'wind' ? 1.6 : 1),
        alpha: item.life / item.maxLife * style.opacity,
        age: 1 - item.life / item.maxLife,
        growth: style.growth,
        angle: style.angle,
      }
      emitter.setParticleLifespan(item.life * 1000)
      emitter.setParticleTint(style.color)
      const particle = emitter.emitParticleAt(item.x, item.y, 1)
      if (particle) {
        particle.velocityX = item.vx
        particle.velocityY = item.vy
      }
    }
  }

  destroy(): void { for (const emitter of this.emitters.values()) emitter.destroy() }
}
