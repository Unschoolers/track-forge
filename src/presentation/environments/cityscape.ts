import { art, ellipse, polygon } from './artPrimitives'
import { createGroundTileRandom } from './groundTexture'
import type { SceneryPrimitive, TrackEnvironmentDefinition } from './types'

const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): SceneryPrimitive =>
  polygon(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    color,
  )

export const CITYSCAPE_ENVIRONMENT: TrackEnvironmentDefinition = {
  label: 'Cityscape',
  day: {
    editorGround: '#858982',
    raceGround: '#858982',
    flyoverGround: '#858982',
    hillSlope: 0x777f79,
    hillPlateau: 0x969b91,
    flyoverHill: '#a2a79b',
    shorelineLand: 0xa8a99a,
    waterFill: 0x396e82,
    waterRipple: 0xa6d2d9,
    waterShoreline: 0xb5bdbc,
    flyoverWater: '#396e82',
  },
  night: {
    editorGround: '#252b31',
    raceGround: '#252b31',
    flyoverGround: '#252b31',
    hillSlope: 0x39444a,
    hillPlateau: 0x4b5759,
    flyoverHill: '#4b5658',
    shorelineLand: 0x64716e,
    waterFill: 0x1e3c52,
    waterRipple: 0x679cae,
    waterShoreline: 0x778b91,
    flyoverWater: '#1e3c52',
  },
  scenery: {
    'city-trash-bin': art('Trash bin', 18, (night) => [
      // Shadow, body, and lid.
      ellipse(4, 7, 14, 10, 0x141a19, 0.28),
      rect(-9, -11, 18, 22, night ? 0x384d4c : 0x496d5c),
      rect(-11, -12, 22, 5, night ? 0x657675 : 0x819789),
    ]),
    'city-bus-stop': art('Bus stop', 35, (night) => [
      // Shadow, shelter, glass roof, and canopy edge.
      ellipse(4, 9, 32, 17, 0x141a19, 0.25),
      rect(-28, -13, 56, 26, night ? 0x566a70 : 0xa7b6ad),
      rect(-23, -9, 46, 17, night ? 0x354e59 : 0x80a5a9),
      rect(-28, -14, 56, 5, night ? 0x758287 : 0xc4c6b9),
    ]),
    'city-house': art('House', 46, (night) => [
      // Shadow, walls, pitched roof, and doorway.
      ellipse(6, 12, 40, 29, 0x141a19, 0.25),
      rect(-32, -25, 64, 50, night ? 0x776b60 : 0xd1c4a5),
      polygon(
        [
          [-36, -18],
          [0, -36],
          [36, -18],
          [36, 10],
          [0, -5],
          [-36, 10],
        ],
        night ? 0x684a46 : 0xa66556,
      ),
      rect(-6, 10, 12, 15, night ? 0x433d38 : 0x806557),
    ]),
    'city-building': art('Building', 58, (night) => [
      // Shadow and stepped rooftop layers.
      ellipse(7, 13, 51, 39, 0x141a19, 0.28),
      rect(-43, -35, 86, 70, night ? 0x616c70 : 0xb2b4aa),
      rect(-36, -28, 72, 56, night ? 0x45545b : 0x8e9d9b),
      rect(-30, -22, 60, 44, night ? 0x6b7777 : 0xb9c2b8),
      rect(-8, -7, 16, 14, night ? 0x414f54 : 0x85928c),
    ]),
  },
  groundArt: (variant, night) => {
    const random = createGroundTileRandom(variant, 0xc17e5c)
    const seam = night ? 0x0d1921 : 0x4b5451
    const bevel = night ? 0x6b7a80 : 0xc8cbc2
    const speck = night ? 0x728087 : 0xd3d4cb
    const dark = night ? 0x171f26 : 0x535f59
    const shapes: SceneryPrimitive[] = []
    // Pavement slab joints align at 64 world units across all 256px tiles.
    // Paired shadow/highlight lines create a subtle raised concrete edge.
    for (let i = 0; i <= 4; i++) {
      const at = i * 64
      shapes.push(rect(at, 0, 1.5, 256, seam))
      shapes.push(polygon([[at + 2, 0], [at + 3, 0], [at + 3, 256], [at + 2, 256]],
        bevel, 0.23))
      shapes.push(polygon([[0, at], [256, at], [256, at + 1.5], [0, at + 1.5]],
        seam, 0.35))
      shapes.push(polygon([[0, at + 2], [256, at + 2], [256, at + 3], [0, at + 3]],
        bevel, 0.2))
    }
    // Fine concrete aggregate, chips and a few hairline imperfections.
    for (let i = 0; i < 255; i++) {
      const x = random() * 256
      const y = random() * 256
      const size = 0.7 + random() * 1.7
      shapes.push(ellipse(x, y, size * 1.3, size * 0.7,
        i % 3 === 0 ? dark : speck, night ? 0.26 : 0.25))
    }
    for (let i = 0; i < 9; i++) {
      const x = 10 + random() * 230
      const y = 10 + random() * 230
      const len = 5 + random() * 17
      shapes.push(polygon([[x, y], [x + len, y + len * 0.25],
        [x + len + 1, y + len * 0.25 + 1], [x, y + 1]],
      dark, night ? 0.3 : 0.22))
    }
    return shapes
  },
}
