import { describe, expect, it } from 'vitest'
import { RaceInputController } from '@/phaser/input/raceInput'

describe('RaceInputController', () => {
  it('maps keyboard controls to the same normalized driver input', () => {
    const input = new RaceInputController()
    input.setKeyboard('ArrowLeft', true)
    input.setKeyboard(' ', true)
    expect(input.snapshot()).toEqual({
      steering: -1,
      throttle: 1,
      braking: true,
    })
    input.setKeyboard('ArrowLeft', false)
    input.setKeyboard(' ', false)
    expect(input.snapshot()).toMatchObject({ steering: 0, braking: false })
  })

  it('supports steering, explicit brake, and two-touch braking', () => {
    const input = new RaceInputController()
    input.beginSteering(1, 0.75)
    input.beginSteering(2, -0.25)
    expect(input.snapshot()).toMatchObject({ steering: 0.75, braking: true })
    input.endPointer(2)
    input.beginBrake(3)
    expect(input.snapshot().braking).toBe(true)
    input.reset()
    expect(input.snapshot()).toEqual({
      steering: 0,
      throttle: 1,
      braking: false,
    })
  })

  it('updates only the active steering pointer and releases controls safely', () => {
    const input = new RaceInputController()
    input.beginSteering(4, -0.4)
    input.updateSteering(99, 1)
    expect(input.snapshot().steering).toBe(-0.4)
    input.updateSteering(4, 0.6)
    expect(input.snapshot().steering).toBe(0.6)
    input.endPointer(4)
    expect(input.snapshot().steering).toBe(0)
  })
})
