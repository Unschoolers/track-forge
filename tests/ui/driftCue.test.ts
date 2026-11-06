import { describe, expect, it } from 'vitest'
import { driftCue } from '@/ui/screens/driftCue'
import type { RaceVehicle } from '@/domain/race/raceState'

const sliding = {
  speed: 160, slip: 27, braking: false, currentSurface: 'street', wrecked: false,
} satisfies Pick<RaceVehicle, 'speed' | 'slip' | 'braking' | 'currentSurface' | 'wrecked'>

describe('slide feel cue', () => {
  it('celebrates fast controlled road drifts', () => {
    expect(driftCue(sliding, 'running', false)).toBe('DRIFT')
    expect(driftCue({ ...sliding, currentSurface: 'ice', slip: 13 }, 'running', false)).toBe('ICE SLIDE')
  })
  it('never rewards brakes, slow corners, grass spins, pauses or a wreck', () => {
    expect(driftCue({ ...sliding, braking: true }, 'running', false)).toBeNull()
    expect(driftCue({ ...sliding, speed: 70 }, 'running', false)).toBeNull()
    expect(driftCue({ ...sliding, currentSurface: 'grass' }, 'running', false)).toBeNull()
    expect(driftCue({ ...sliding, wrecked: true }, 'running', false)).toBeNull()
    expect(driftCue(sliding, 'running', true)).toBeNull()
    expect(driftCue(sliding, 'countdown', false)).toBeNull()
    expect(driftCue(sliding, 'finished', false)).toBeNull()
  })
})
