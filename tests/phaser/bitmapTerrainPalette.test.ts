import { describe, expect, it } from 'vitest'
import { DESERT_TERRAIN_ART, MEADOW_TERRAIN_ART } from '@/presentation/environments/bitmapTerrainPalette'

describe('bitmap terrain profiles', () => {
  it('keeps the Desert oasis and dune colors independent from Meadow', () => {
    expect(DESERT_TERRAIN_ART.day.outerBank).not.toBe(MEADOW_TERRAIN_ART.day.outerBank)
    expect(DESERT_TERRAIN_ART.day.plateauGlaze).not.toBe(MEADOW_TERRAIN_ART.day.plateauGlaze)
    expect(DESERT_TERRAIN_ART.night.deepGlaze).not.toBe(DESERT_TERRAIN_ART.day.deepGlaze)
    for (const profile of [DESERT_TERRAIN_ART, MEADOW_TERRAIN_ART]) {
      for (const lighting of ['day', 'night'] as const) {
        const palette = profile[lighting]
        expect(palette.shallow).toHaveLength(3)
        expect(palette.slopeShadowStrength * 4).toBeLessThan(1)
        expect(palette.slopeLightStrength * 4).toBeLessThan(1)
      }
    }
  })
})
