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

  it('brakes only for an explicit brake pointer, even with two steering touches', () => {
    const input = new RaceInputController()
    input.beginSteering(1, 0.75)
    input.beginSteering(2, -0.25)
    expect(input.snapshot()).toMatchObject({ steering: 0.75, braking: false })
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

  it('hands steering to the oldest remaining finger at its latest position', () => {
    const input = new RaceInputController()
    input.beginSteering(4, 0)
    input.updateSteering(4, -0.4)
    input.beginSteering(5, 0)
    input.beginSteering(6, 0)
    input.updateSteering(5, 0.6)
    input.updateSteering(6, -0.8)
    expect(input.snapshot().steering).toBe(-0.4)
    input.endPointer(4)
    expect(input.snapshot().steering).toBe(0.6)
    input.endPointer(5)
    expect(input.snapshot().steering).toBe(-0.8)
    input.endPointer(6)
    expect(input.snapshot().steering).toBe(0)
  })

  it('keeps a new steering touch neutral while a keyboard direction is held', () => {
    const input = new RaceInputController()
    input.setKeyboard('ArrowRight', true)
    input.beginSteering(1, 0)
    expect(input.snapshot().steering).toBe(0)
    input.endPointer(1)
    expect(input.snapshot().steering).toBe(1)
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
