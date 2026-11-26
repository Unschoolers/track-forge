import type { CarId } from '@/domain/model'

export interface EngineVoiceInput {
  readonly car: CarId
  readonly frequency: number
  readonly revRatio: number
  readonly load: number
}

export interface EngineVoice {
  readonly coreFrequency: number
  readonly pulseFrequency: number
  readonly pulseGain: number
  readonly noiseGain: number
  readonly filterFrequency: number
  readonly outputGain: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

const ENGINE_TIMBRE = {
  blue: { pulse: 0.72, grit: 0.62, brightness: 1.04 },
  red: { pulse: 1.22, grit: 0.9, brightness: 1.2 },
  green: { pulse: 0.86, grit: 1.28, brightness: 0.88 },
  yellow: { pulse: 1.14, grit: 0.78, brightness: 0.78 },
} as const

export function calculateEngineVoice(input: EngineVoiceInput): EngineVoice {
  const timbre = ENGINE_TIMBRE[input.car]
  const coreFrequency = clamp(
    Number.isFinite(input.frequency) ? input.frequency : 40,
    40,
    260,
  )
  const revRatio = clamp(
    Number.isFinite(input.revRatio) ? input.revRatio : 0,
    0,
    1,
  )
  const load = clamp(
    Number.isFinite(input.load) ? input.load : 0,
    0,
    1,
  )

  return {
    coreFrequency,
    // A half-speed pulse creates the chunky cylinder cadence heard in early
    // game synths without turning higher gears into a piercing whine.
    pulseFrequency: coreFrequency * 0.5,
    pulseGain: (0.045 + load * 0.065) * timbre.pulse,
    noiseGain: (0.006 + load * 0.018 + revRatio * 0.004) * timbre.grit,
    filterFrequency: (620 + coreFrequency * 3.2 + load * 280) * timbre.brightness,
    outputGain: 0.012 + load * 0.023,
  }
}
