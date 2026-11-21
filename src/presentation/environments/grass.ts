import { art, ellipse, polygon } from './artPrimitives'
import { GROUND_TILE_SIZE } from '@/presentation/environments/groundTexture'
import type { EnvironmentPalette } from '@/presentation/environments/types'

export const GRASS_ENVIRONMENT = {
  day: {
    editorGround: '#2d7344',
    raceGround: '#2d7344',
    flyoverGround: '#568453',
    hillSlope: 0x398858,
    hillPlateau: 0x4c9d63,
    flyoverHill: '#80a66a',
    shorelineLand: 0x83a764,
  },
  night: {
    editorGround: '#14251b',
    raceGround: '#0e2b1d',
    flyoverGround: '#182d2b',
    hillSlope: 0x1b452a,
    hillPlateau: 0x235433,
    flyoverHill: '#34533f',
    shorelineLand: 0x59715f,
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

  let state = variant + 12345
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const lighter = night ? 0x79916a : 0xb1bc80
  const darker = night ? 0x304b3b : 0x547346
  const marks: GrassMark[] = []
  for (let i = 0; i < 28; i++) {
    const tuft = i >= 12
    marks.push({
      x: random() * GROUND_TILE_SIZE,
      y: random() * GROUND_TILE_SIZE,
      radiusX: tuft ? 4 + random() * 5 : 24 + random() * 30,
      radiusY: tuft ? 2 + random() * 3 : 13 + random() * 20,
      color: i % 2 === 0 ? lighter : darker,
      alpha: tuft ? 0.10 : 0.055,
    })
  }

  textures.set(key, marks)
  return marks
}
