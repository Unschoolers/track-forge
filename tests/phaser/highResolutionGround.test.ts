import { describe, expect, it, vi } from 'vitest'
import { GROUND_TILE_SIZE } from '@/presentation/environments/groundTexture'
import { GROUND_ART_SIZE, paintBitmapGround, type EnvironmentBitmapArt } from '@/presentation/environments/meadowBitmapArt'
import { createElevationMaterials } from '@/presentation/environments/elevationMaterials'
import { MEADOW_TERRAIN_ART } from '@/presentation/environments/bitmapTerrainPalette'

describe('high resolution ground artwork', () => {
  it('paints the complete 256px source once without sub-tile repetition or resampling', () => {
    const ground = { width: GROUND_TILE_SIZE, height: GROUND_TILE_SIZE } as HTMLCanvasElement
    const art: EnvironmentBitmapArt = {
      road: { street: ground, dirt: ground, ice: ground },
      patches: [],
      sand: ground,
      water: ground,
      elevationMaterials: createElevationMaterials(ground, {
        plateau: ground, slope: ground, shading: MEADOW_TERRAIN_ART.day.raised,
      }),
      terrainPalette: MEADOW_TERRAIN_ART.day,
    }
    const drawImage = vi.fn()
    const context = { drawImage } as unknown as CanvasRenderingContext2D
    paintBitmapGround(context, art, 0, 64)
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(ground, 64, 64, 256, 256)
    drawImage.mockClear()
    paintBitmapGround(context, art, 0, 64, true)
    expect(drawImage).not.toHaveBeenCalled()
    expect(GROUND_ART_SIZE / GROUND_TILE_SIZE).toBe(4)
  })
})
