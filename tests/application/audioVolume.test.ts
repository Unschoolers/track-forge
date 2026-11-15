import { describe, expect, it } from 'vitest'
import { musicGain } from '@/application/audioVolume'

describe('music gain', () => {
  it('keeps mute silent and maps the music slider to the revised mix', () => {
    expect(musicGain(0)).toBe(0)
    expect(musicGain(70)).toBeCloseTo(0.4, 2)
    expect(musicGain(100)).toBe(0.7)
  })
})
