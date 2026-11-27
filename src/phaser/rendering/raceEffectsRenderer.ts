import type Phaser from 'phaser'
import type { RaceEffectsState } from '@/domain/race/effects'
import { raceParticleStyle } from '@/phaser/rendering/raceParticleStyle'

export function renderRaceEffects(
  graphics: Phaser.GameObjects.Graphics,
  effects: RaceEffectsState,
  nativeParticles = false,
  desert = false,
  raised = false,
): void {
  for (const skid of effects.skids) {
    if (Boolean(skid.raised) !== raised) continue
    graphics.lineStyle(skid.width, 0x15191e, 0.52 * (skid.life / skid.maxLife))
    graphics.lineBetween(skid.start.x, skid.start.y, skid.end.x, skid.end.y)
  }
  if (nativeParticles) return
  for (const particle of effects.particles) {
    if (Boolean(particle.raised) !== raised) continue
    const style = raceParticleStyle(particle, desert)
    const remaining = Math.max(0, particle.life / particle.maxLife)
    if (style.shape === 'wind') {
      const speed = Math.hypot(particle.vx, particle.vy)
      if (speed > 0) {
        const length = style.size * 8
        graphics.lineStyle(style.size * 0.75, style.color, remaining * style.opacity)
        graphics.lineBetween(particle.x, particle.y,
          particle.x - particle.vx / speed * length, particle.y - particle.vy / speed * length)
      }
      continue
    }
    graphics.fillStyle(style.color, remaining * style.opacity)
    graphics.fillCircle(particle.x, particle.y, style.size * (1 + (1 - remaining) * style.growth))
  }
}
