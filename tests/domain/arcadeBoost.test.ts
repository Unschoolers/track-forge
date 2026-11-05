import { describe, expect, it } from 'vitest'
import { advanceArcadeBoost } from '@/domain/race/arcadeBoost'

describe('arcade drift boost', () => {
  it('charges during controlled slides and activates after steering release', () => {
    let boost = { charge: 0, remaining: 0 }
    for (let step = 0; step < 85; step += 1) {
      boost = advanceArcadeBoost(boost, {
        speed: 180,
        slip: 35,
        steering: 0.6,
        grounded: true,
      }, 1 / 60)
    }
    expect(boost.charge).toBe(1)
    expect(boost.remaining).toBe(0)
    const activated = advanceArcadeBoost(boost, {
      speed: 180,
      slip: 4,
      steering: 0,
      grounded: true,
    }, 1 / 60)
    expect(activated.activated).toBe(true)
    expect(activated.remaining).toBeGreaterThan(1)
    expect(activated.charge).toBe(0)
    const continuing = advanceArcadeBoost(activated, {
      speed: 240,
      slip: 0,
      steering: 0,
      grounded: true,
    }, 1 / 60)
    expect(continuing.activated).toBe(false)
    expect(continuing.remaining).toBeLessThan(activated.remaining)
  })

  it('does not charge when airborne or driving straight and resets in simulation', () => {
    const sample = { speed: 200, slip: 40, steering: 0.5, grounded: false }
    expect(advanceArcadeBoost({ charge: 0, remaining: 0 }, sample, 1 / 60).charge).toBe(0)
    expect(advanceArcadeBoost({ charge: 0, remaining: 0 }, {
      ...sample, grounded: true, steering: 0,
    }, 1 / 60).charge).toBe(0)
    expect(advanceArcadeBoost({ charge: 0.7, remaining: 1 }, sample, 1 / 60, false))
      .toEqual({ charge: 0, remaining: 0, activated: false })
  })
})
