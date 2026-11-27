import { describe, expect, it, vi } from 'vitest'
import type Phaser from 'phaser'
import { NativeRaceParticles, ParticleEmissionCursor } from '@/phaser/rendering/nativeRaceParticles'
import { raceParticleStyle } from '@/phaser/rendering/raceParticleStyle'
import type { RaceParticle } from '@/domain/race/effects'

const particle = (emissionId: number): RaceParticle => ({
  emissionId, kind: 'dirt', x: 0, y: 0, vx: 1, vy: 2, life: 0.5, maxLife: 0.5, size: 4,
})

describe('native race particle emissions', () => {
  it('emits each live descriptor once even when several ticks pass between draws', () => {
    const cursor = new ParticleEmissionCursor()
    const state = (...particles: RaceParticle[]) => ({ particles, skids: [], previousTires: {} })
    expect(cursor.update(state(particle(0)))).toEqual([particle(0)])
    expect(cursor.update(state({ ...particle(0), life: 0.3 }, particle(1), particle(2)))).toEqual([particle(1), particle(2)])
    expect(cursor.update(state(particle(1), particle(2)))).toEqual([])
    const wind = { ...particle(3), kind: 'speed-line' as const }
    expect(cursor.update(state(wind))).toEqual([wind])
    expect(cursor.update(state(wind))).toEqual([])
  })
})

describe('subtle particle appearance', () => {
  it('uses occasional debris on dirt, powder on ice and only soft sand on desert', () => {
    expect(raceParticleStyle(particle(0)).shape).toBe('debris')
    expect(raceParticleStyle(particle(1)).shape).toBe('puff')
    expect(raceParticleStyle(particle(0), true).shape).toBe('puff')
    expect(raceParticleStyle({ ...particle(0), kind: 'ice' }).shape).toBe('puff')
    expect(raceParticleStyle({ ...particle(0), kind: 'speed-line' }).shape).toBe('wind')
  })
})

describe('native particle pool lifetime', () => {
  it.each([[false, 180], [true, 90]] as const)('caps live particles and keeps emitting after pooled particles expire (low=%s)', (low, budget) => {
    const configs: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig[] = []
    const emissions: ReturnType<typeof vi.fn>[] = []
    const scene = {
      textures: { exists: () => true },
      add: { particles: (_x: number, _y: number, _texture: string, config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) => {
        configs.push(config)
        const emit = vi.fn(() => ({ velocityX: 0, velocityY: 0 }))
        emissions.push(emit)
        const emitter = { setDepth: () => emitter, setActive: () => emitter, preUpdate: vi.fn(),
          setParticleLifespan: vi.fn(), setParticleTint: vi.fn(), emitParticleAt: emit, destroy: vi.fn() }
        return emitter
      } },
    } as unknown as Phaser.Scene
    const native = new NativeRaceParticles(scene, 25, false, low)
    expect(configs.every(config => config.maxParticles === undefined)).toBe(true)
    expect(configs.reduce((sum, config) => sum + (config.maxAliveParticles ?? 0), 0)).toBe(budget)
    // Repeated unique births after the original hard-cap count would have been reached.
    for (let tick = 0; tick < 160; tick++) {
      native.render({ particles: [{ ...particle(tick * 10 + 2), kind: 'dirt' }], skids: [], previousTires: {} }, tick * 60)
    }
    expect(emissions[0]).toHaveBeenCalledTimes(160)
    native.destroy()
  })
})
