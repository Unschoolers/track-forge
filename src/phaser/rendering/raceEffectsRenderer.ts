import type Phaser from 'phaser'
import type { RaceEffectsState, RaceParticleKind } from '@/domain/race/effects'

const PARTICLE_COLORS: Record<RaceParticleKind, number> = {
  dirt: 0xb78553,
  grass: 0x89ad67,
  ice: 0xebfaff,
  'tire-smoke': 0xb9c0c8,
  spark: 0xffb347,
  'damage-smoke': 0x62676e,
  'speed-line': 0xe8f3ff,
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
    const progress = 1 - particle.life / particle.maxLife
    graphics.fillStyle(
      PARTICLE_COLORS[particle.kind],
      Math.max(0, particle.life / particle.maxLife),
    )
    graphics.fillCircle(
      particle.x,
      particle.y,
      particle.size * (1 + progress * 0.8),
    )
  }
}
