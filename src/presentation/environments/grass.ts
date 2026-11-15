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
  for (let i = 0; i < 16; i++) {
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
