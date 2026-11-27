import { describe, expect, it } from 'vitest'
import { ParticleEmissionCursor } from '@/phaser/rendering/nativeRaceParticles'
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
    expect(cursor.update(state({ ...particle(3), kind: 'speed-line' }))).toEqual([])
  })
})
