import { describe, expect, it } from 'vitest'
import { WORLD_ELEVATION } from '@/domain/config'
import { createElevationMaterials, elevationLevelForHeight, elevationMaterialForLevel, groupElevationFaces, type ElevationMaterial, type ElevationMaterials } from '@/presentation/environments/elevationMaterials'
import { CITY_TERRAIN_ART, DESERT_TERRAIN_ART, KIDS_ROOM_TERRAIN_ART, MEADOW_TERRAIN_ART } from '@/presentation/environments/bitmapTerrainPalette'

const raised: ElevationMaterial<string> = {
  plateau: 'dark grass',
  slope: 'mossy rock',
  shading: MEADOW_TERRAIN_ART.day.raised,
}

describe('elevation material selection', () => {
  it('selects the base and raised textures independently, including the incoming slope', () => {
    const materials = createElevationMaterials('grass', raised)
    expect(materials).toHaveLength(2)
    expect(elevationMaterialForLevel(materials, 0)).toMatchObject({
      plateau: 'grass', slope: 'grass', shading: { slopeShadowStrength: 0, slopeLightStrength: 0 },
    })
    expect(elevationMaterialForLevel(materials, 1)).toBe(raised)
  })

  it('reuses the highest defined material for future levels and allows new entries', () => {
    const materials = createElevationMaterials('grass', raised)
    const second = { ...raised, plateau: 'bare rock', slope: 'cliff' }
    const extended: ElevationMaterials<string> = [...materials, second]
    expect(elevationMaterialForLevel(materials, 4)).toBe(raised)
    expect(elevationMaterialForLevel(extended, 1)).toBe(raised)
    expect(elevationMaterialForLevel(extended, 2)).toBe(second)
    expect(elevationMaterialForLevel(extended, 100)).toBe(second)
  })

  it('uses nominal canonical mesh heights, not fractional slope heights', () => {
    expect(elevationLevelForHeight(WORLD_ELEVATION.baseHeight)).toBe(0)
    expect(elevationLevelForHeight(WORLD_ELEVATION.baseHeight + WORLD_ELEVATION.levelHeight)).toBe(1)
    expect(elevationLevelForHeight(WORLD_ELEVATION.baseHeight + 3 * WORLD_ELEVATION.levelHeight)).toBe(3)
    for (const invalid of [-1, 0.5, Infinity, NaN]) {
      expect(() => elevationLevelForHeight(invalid)).toThrow('Invalid nominal terrain height')
      expect(() => elevationMaterialForLevel(createElevationMaterials('grass', raised), invalid)).toThrow('Invalid terrain material level')
    }
  })

  it('groups by actual level in ascending painter order, even for fallback levels', () => {
    const slope = { level: 2, id: 'slope' }
    const plateau = { level: 2, id: 'plateau' }
    const low = { level: 1, id: 'low' }
    const high = { level: 3, id: 'high' }
    expect(groupElevationFaces([high, slope, low, plateau])).toEqual([
      [1, [low]], [2, [slope, plateau]], [3, [high]],
    ])
    expect(groupElevationFaces([])).toEqual([])
  })

  it('preserves independently authored day/night raised shading in every theme', () => {
    for (const profile of [MEADOW_TERRAIN_ART, DESERT_TERRAIN_ART, CITY_TERRAIN_ART, KIDS_ROOM_TERRAIN_ART]) {
      for (const lighting of ['day', 'night'] as const) {
        const material = { plateau: 'top', slope: 'side', shading: profile[lighting].raised }
        const levels = createElevationMaterials('ground', material)
        expect(elevationMaterialForLevel(levels, 1).shading).toBe(profile[lighting].raised)
        expect(elevationMaterialForLevel(levels, 0).shading).not.toBe(profile[lighting].raised)
      }
    }
  })
})
