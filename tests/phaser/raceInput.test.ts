import { describe, expect, it } from 'vitest'
import { RaceInputController, inputForHandling } from '@/phaser/input/raceInput'
import { steeringFromDrag } from '@/phaser/input/racePointer'

describe('RaceInputController', () => {
  it('keeps automatic throttle in Arcade but uses manual throttle in Simulation', () => {
    const input = new RaceInputController().snapshot()
    expect(inputForHandling(input, 'arcade').throttle).toBe(1)
    expect(inputForHandling(input, undefined).throttle).toBe(1)
    expect(inputForHandling(input, 'simulation').throttle).toBe(0)
  })

  it('holds throttle independently across keys and multiple pointers', () => {
    const input = new RaceInputController()
    expect(input.snapshot().throttle).toBe(0)
    input.setKeyboard('w', true)
    input.setKeyboard('ArrowUp', true)
    input.setKeyboard('w', false)
    expect(input.snapshot().throttle).toBe(1)
    input.beginSteering(1, -0.5)
    input.beginThrottle(2)
    input.beginThrottle(3)
    input.beginBrake(4)
    input.setKeyboard('ArrowUp', false)
    input.endPointer(2)
    expect(input.snapshot()).toEqual({ steering: -0.5, throttle: 1, braking: true })
    input.endPointer(3)
    expect(input.snapshot()).toEqual({ steering: -0.5, throttle: 0, braking: true })
    input.reset()
    expect(input.snapshot()).toEqual({ steering: 0, throttle: 0, braking: false })
  })

  it('restores held button and keyboard directions independently of pedals', () => {
    const input = new RaceInputController()
    input.setKeyboard('a', true)
    input.beginSteeringButton(1, 1)
    input.beginBrake(2)
    input.beginThrottle(3)
    input.beginSteeringButton(4, -1)
    expect(input.snapshot()).toEqual({ steering: -1, throttle: 1, braking: true })
    input.endPointer(4)
    expect(input.snapshot().steering).toBe(1)
    input.endPointer(1)
    expect(input.snapshot()).toEqual({ steering: -1, throttle: 1, braking: true })
    input.reset()
    expect(input.snapshot()).toEqual({ steering: 0, throttle: 0, braking: false })
  })

  it('provides fine center steering while retaining full lock after a 48px drag', () => {
    expect(steeringFromDrag(0)).toBe(0)
    expect(steeringFromDrag(3)).toBe(0)
    expect(steeringFromDrag(24)).toBeGreaterThan(0.25)
    expect(steeringFromDrag(24)).toBeLessThan(0.4)
    expect(steeringFromDrag(-24)).toBeCloseTo(-steeringFromDrag(24))
    expect(steeringFromDrag(48)).toBe(1)
    expect(steeringFromDrag(-200)).toBe(-1)
    expect(steeringFromDrag(Number.NaN)).toBe(0)
  })

  it('restores a still-held direction after releasing the opposite key', () => {
    const input = new RaceInputController()
    input.setKeyboard('a', true)
    input.setKeyboard('d', true)
    expect(input.snapshot().steering).toBe(1)
    input.setKeyboard('d', false)
    expect(input.snapshot().steering).toBe(-1)
    input.setKeyboard('a', false)
    expect(input.snapshot().steering).toBe(0)
  })

  it('maps keyboard controls to the same normalized driver input', () => {
    const input = new RaceInputController()
    input.setKeyboard('ArrowLeft', true)
    input.setKeyboard(' ', true)
    expect(input.snapshot()).toEqual({
      steering: -1,
      throttle: 0,
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
      throttle: 0,
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
