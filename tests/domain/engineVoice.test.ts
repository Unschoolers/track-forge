import { describe, expect, it } from 'vitest'
import { CAR_IDS } from '@/domain/model'
import {
  calculateEngineVoice,
  type EngineVoiceInput,
} from '@/domain/audio/engineVoice'

function input(overrides: Partial<EngineVoiceInput> = {}): EngineVoiceInput {
  return {
    car: 'blue',
    frequency: 120,
    revRatio: 0.5,
    load: 0.4,
    ...overrides,
  }
}

describe('engine voice', () => {
  it('layers a low pulse beneath the gearbox tone without raising its pitch', () => {
    const voice = calculateEngineVoice(input())

    expect(voice.coreFrequency).toBe(120)
    expect(voice.pulseFrequency).toBe(60)
    expect(voice.filterFrequency).toBeLessThan(1_800)
    expect(voice.outputGain).toBeLessThanOrEqual(0.04)
  })

  it('adds mechanical grit under load while keeping the mix restrained', () => {
    const coasting = calculateEngineVoice(input({ load: 0.22 }))
    const accelerating = calculateEngineVoice(input({ load: 1 }))

    expect(accelerating.pulseGain).toBeGreaterThan(coasting.pulseGain)
    expect(accelerating.noiseGain).toBeGreaterThan(coasting.noiseGain)
    expect(accelerating.filterFrequency).toBeGreaterThan(
      coasting.filterFrequency,
    )
    expect(accelerating.outputGain).toBeLessThanOrEqual(0.04)
  })

  it('normalizes invalid external values into finite audio parameters', () => {
    const voice = calculateEngineVoice({
      car: 'blue',
      frequency: Number.NaN,
      revRatio: 4,
      load: -2,
    })

    expect(Object.values(voice).every(Number.isFinite)).toBe(true)
    expect(voice.coreFrequency).toBeGreaterThanOrEqual(40)
    expect(voice.noiseGain).toBeGreaterThanOrEqual(0)
  })

  it('gives each car a distinct engine timbre at the same physical state', () => {
    const state = input()
    const voices = CAR_IDS.map((car) =>
      calculateEngineVoice({ ...state, car }),
    )
    expect(new Set(voices.map((voice) => voice.pulseGain)).size).toBe(4)
    expect(calculateEngineVoice({ ...state, car: 'red' }).filterFrequency)
      .toBeGreaterThan(calculateEngineVoice({ ...state, car: 'yellow' }).filterFrequency)
    expect(calculateEngineVoice({ ...state, car: 'green' }).noiseGain)
      .toBeGreaterThan(calculateEngineVoice({ ...state, car: 'blue' }).noiseGain)
  })
})
