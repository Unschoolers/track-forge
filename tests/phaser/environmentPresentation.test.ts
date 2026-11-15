import { describe, expect, it } from 'vitest'
import { GRASS_ENVIRONMENT } from '@/presentation/environments/grass'

describe('Grass environment presentation', () => {
  it('preserves the day and night terrain palettes', () => {
    expect(GRASS_ENVIRONMENT.day).toEqual({
      editorGround: '#2d7344',
      raceGround: '#2d7344',
      flyoverGround: '#568453',
      hillSlope: 0x398858,
      hillPlateau: 0x4c9d63,
      flyoverHill: '#80a66a',
      shorelineLand: 0x83a764,
    })
    expect(GRASS_ENVIRONMENT.night).toEqual({
      editorGround: '#14251b',
      raceGround: '#0e2b1d',
      flyoverGround: '#182d2b',
      hillSlope: 0x1b452a,
      hillPlateau: 0x235433,
      flyoverHill: '#34533f',
      shorelineLand: 0x59715f,
    })
  })
})
