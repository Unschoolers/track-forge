import type Phaser from 'phaser'
import type { RaceEffectsState, RaceParticleKind } from '@/domain/race/effects'

const PARTICLE_COLORS: Record<RaceParticleKind, number> = {
  dirt: 0xb78553,
  grass: 0x89ad67,
  ice: 0xebfaff,
  'tire-smoke': 0xb9c0c8,
  'speed-line': 0xe8f3ff,
  'landing-dust': 0xa6afb9,
}

export function renderRaceEffects(
  graphics: Phaser.GameObjects.Graphics,
  effects: RaceEffectsState,
): void {
  for (const skid of effects.skids) {
    graphics.lineStyle(
      skid.width,
      0x15191e,
      0.52 * (skid.life / skid.maxLife),
    )
    graphics.lineBetween(
      skid.start.x,
      skid.start.y,
      skid.end.x,
      skid.end.y,
    )
  }
  for (const particle of effects.particles) {
    if (particle.kind === 'speed-line') {
      const speed = Math.hypot(particle.vx, particle.vy)
      if (speed > 0) {
        const length = particle.size * 8
        graphics.lineStyle(particle.size, PARTICLE_COLORS[particle.kind], Math.max(0, particle.life / particle.maxLife))
        graphics.lineBetween(
          particle.x,
          particle.y,
          particle.x - particle.vx / speed * length,
          particle.y - particle.vy / speed * length,
        )
      }
      continue
    }
    const progress = 1 - particle.life / particle.maxLife
    graphics.fillStyle(
      PARTICLE_COLORS[particle.kind],
      (particle.kind === 'landing-dust' ? 0.6 : 1) * Math.max(0, particle.life / particle.maxLife),
    )
    graphics.fillCircle(
      particle.x,
      particle.y,
      particle.size * (1 + progress * 0.8),
    )
  }
}
