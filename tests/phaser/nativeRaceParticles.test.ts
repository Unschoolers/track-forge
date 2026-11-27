import { describe, expect, it } from 'vitest'
import { ParticleEmissionCursor } from '@/phaser/rendering/nativeRaceParticles'
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
