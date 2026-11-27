import type { RaceParticle } from '@/domain/race/effects'

export type ParticleShape = 'puff' | 'debris' | 'wind'

export function raceParticleStyle(item: RaceParticle, desert = false) {
  const id = item.emissionId ?? 0
  const angle = Math.atan2(item.vy, item.vx) * 180 / Math.PI
  switch (item.kind) {
    case 'speed-line': return { shape: 'wind' as const, color: 0xe8f3ff, opacity: 0.56, size: item.size, angle, growth: 0 }
    case 'grass': return desert
      ? { shape: 'puff' as const, color: 0xd7bc86, opacity: 0.45, size: item.size, angle, growth: 0.8 }
      : { shape: 'debris' as const, color: 0x84a257, opacity: 0.65, size: item.size * 0.8, angle, growth: 0 }
    case 'dirt': return !desert && id % 5 === 0
      ? { shape: 'debris' as const, color: 0x96714c, opacity: 0.72, size: item.size * 0.62, angle, growth: 0 }
      : { shape: 'puff' as const, color: desert ? 0xd7bc86 : 0xb78553, opacity: 0.55, size: item.size, angle, growth: 0.8 }
    case 'ice': return { shape: 'puff' as const, color: 0xebfaff, opacity: 0.55, size: item.size, angle, growth: 0.7 }
    case 'water': return { shape: 'puff' as const, color: 0xc5eaf2, opacity: 0.7, size: item.size, angle, growth: 0.15 }
    case 'tire-smoke': return { shape: 'puff' as const, color: 0xb9c0c8, opacity: 0.45, size: item.size, angle, growth: 0.8 }
    case 'landing-dust': return { shape: 'puff' as const, color: 0xa6afb9, opacity: 0.45, size: item.size, angle, growth: 0.8 }
  }
}
