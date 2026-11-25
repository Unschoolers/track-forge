import { art, ellipse, polygon } from './artPrimitives'
import { GROUND_TILE_SIZE, createGroundTileRandom } from '@/presentation/environments/groundTexture'
import type { EnvironmentPalette } from '@/presentation/environments/types'
import { meadowGroundPatches } from './meadowGroundPatches'
import { MEADOW_SHORELINE } from './shorelineMaterials'

export const GRASS_ENVIRONMENT = {
  day: {
    editorGround: '#2d7344',
    raceGround: '#2d7344',
    flyoverGround: '#2d7344',
    hillSlope: 0x657b54,
    hillPlateau: 0x245734,
    flyoverHill: '#245734',
    shorelineLand: 0x83a764,
    shorelineBands: MEADOW_SHORELINE.day,
  },
  night: {
    editorGround: '#0e2b1d',
    raceGround: '#0e2b1d',
    flyoverGround: '#0e2b1d',
    hillSlope: 0x304638,
    hillPlateau: 0x0b2118,
    flyoverHill: '#0b2118',
    shorelineLand: 0x59715f,
    shorelineBands: MEADOW_SHORELINE.night,
  },
} satisfies Record<'day' | 'night', EnvironmentPalette>

/** Placeable grassland scenery uses the same saving, undo and collision pipeline as other themes. */
export const GRASS_SCENERY = {
  'grass-shrub': art('Shrub', 31, (night) => [
    ellipse(5, 9, 27, 18, 0x182c1e, 0.24),
    ellipse(-10, 0, 17, 16, night ? 0x2b5740 : 0x397c45),
    ellipse(10, 2, 18, 17, night ? 0x245136 : 0x42894c),
    ellipse(0, -10, 18, 14, night ? 0x386b4c : 0x64a85f),
    ellipse(-6, -14, 7, 5, night ? 0x4d7960 : 0x90bf75, 0.7),
  ]),
  'grass-wildflowers': art('Wildflowers', 27, (night) => [
    ellipse(3, 9, 24, 13, 0x172b1e, 0.18),
    ellipse(-12, 4, 11, 8, night ? 0x32684a : 0x4d914f),
    ellipse(7, -2, 13, 9, night ? 0x316044 : 0x569c58),
    ellipse(16, 7, 8, 7, night ? 0x2b583f : 0x4b8c4d),
    ellipse(-13, -1, 4, 4, night ? 0xb9a6b9 : 0xffd0e3),
    ellipse(4, -8, 5, 4, night ? 0xb4afcf : 0xebd8ff),
    ellipse(14, 3, 4, 4, night ? 0xb5b17e : 0xffe58b),
    ellipse(-2, 11, 3, 3, night ? 0xb9a6b9 : 0xffd0e3),
  ]),
  'grass-boulder': art('Mossy boulder', 35, (night) => [
    ellipse(5, 10, 30, 21, 0x17241d, 0.3),
    polygon([[-27, 6], [-20, -15], [-4, -23], [19, -19], [29, -3], [21, 18], [-12, 20]],
      night ? 0x56665d : 0x89998a),
    polygon([[-20, -12], [-4, -20], [12, -16], [3, -3], [-24, 3]],
      night ? 0x829286 : 0xb7c3ac),
    ellipse(12, 11, 12, 6, night ? 0x42664a : 0x63965d, 0.86),
  ]),
  'grass-log': art('Fallen log', 43, (night) => [
    ellipse(4, 10, 40, 16, 0x17241d, 0.28),
    polygon([[-34, -10], [29, -13], [36, 2], [29, 13], [-34, 11]],
      night ? 0x5c4736 : 0x886347),
    polygon([[-32, -10], [27, -12], [23, -6], [-31, -3]],
      night ? 0x927459 : 0xbc906a),
    ellipse(30, 0, 7, 12, night ? 0x8c735d : 0xc49b78),
    ellipse(30, 0, 3, 7, night ? 0x594635 : 0x8b6648),
  ]),
} as const

interface GrassMark {
  readonly x: number
  readonly y: number
  readonly radiusX: number
  readonly radiusY: number
  readonly color: number
  readonly alpha: number
}

const textures = new Map<string, readonly GrassMark[]>()

/** Prepare each tile variant once for both the race and the flyover. */
export function getGrassTexture(variant: number, night: boolean): readonly GrassMark[] {
  const key = `${variant}:${night}`
  const cached = textures.get(key)
  if (cached) return cached

  const random = createGroundTileRandom(variant, 0x5a1a5)
  const lighter = night ? 0x698c69 : 0x9ccf76
  const darker = night ? 0x142f23 : 0x174e33
  const mid = night ? 0x3b6650 : 0x5dac57
  const marks: GrassMark[] = []
  // Large soft variations survive zoom-out; dense short blades sell grass
  // at racing speed without distracting from the asphalt.
  for (let i = 0; i < 20; i++) {
    marks.push({
      x: random() * GROUND_TILE_SIZE,
      y: random() * GROUND_TILE_SIZE,
      radiusX: 15 + random() * 36,
      radiusY: 12 + random() * 25,
      color: i % 3 === 0 ? lighter : darker,
      alpha: night ? 0.06 : 0.055,
    })
  }
  marks.push(...meadowGroundPatches(variant, night))
  for (let i = 0; i < 430; i++) {
    marks.push({
      x: random() * GROUND_TILE_SIZE,
      y: random() * GROUND_TILE_SIZE,
      radiusX: 0.7 + random() * 1.1,
      radiusY: 2 + random() * 5,
      color: i % 6 === 0 ? darker : i % 3 === 0 ? lighter : mid,
      alpha: night ? 0.24 : 0.27,
    })
  }
  // Sparse pale seed heads add scale without becoming decorative props.
  for (let i = 0; i < 15; i++) {
    marks.push({
      x: random() * GROUND_TILE_SIZE,
      y: random() * GROUND_TILE_SIZE,
      radiusX: 1.1, radiusY: 2.2,
      color: night ? 0x778a61 : 0xc3d4a0,
      alpha: 0.26,
    })
  }

  textures.set(key, marks)
  return marks
}
