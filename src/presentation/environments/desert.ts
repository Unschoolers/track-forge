import { art, ellipse, polygon } from './artPrimitives'
import { createGroundTileRandom } from './groundTexture'
import type { TrackEnvironmentDefinition } from './types'

export const DESERT_ENVIRONMENT: TrackEnvironmentDefinition = {
  label: 'Desert',
  day: {
    editorGround: '#bd9d6b',
    raceGround: '#bd9d6b',
    flyoverGround: '#bd9d6b',
    hillSlope: 0xa8865d,
    hillPlateau: 0xd0b081,
    flyoverHill: '#d6ba8d',
    shorelineLand: 0xd2bd91,
    waterFill: 0x338d91,
    waterRipple: 0xb1eee0,
    waterShoreline: 0xf4dfb7,
    flyoverWater: '#338d91',
  },
  night: {
    editorGround: '#3c3734',
    raceGround: '#3c3734',
    flyoverGround: '#3c3734',
    hillSlope: 0x5b5147,
    hillPlateau: 0x736454,
    flyoverHill: '#776b5e',
    shorelineLand: 0x817568,
    waterFill: 0x224b5e,
    waterRipple: 0x78a6aa,
    waterShoreline: 0xb99a70,
    flyoverWater: '#224b5e',
  },
  scenery: {
    'desert-cactus': art('Cactus', 27, (night) => [
      // Shadow, stem, arms, and highlight.
      ellipse(4, 8, 22, 15, 0x34271e, 0.26),
      ellipse(0, 0, 10, 20, night ? 0x3e6252 : 0x507d52),
      ellipse(-11, -2, 7, 9, night ? 0x476b56 : 0x619363),
      ellipse(10, -6, 7, 8, night ? 0x3a5a4a : 0x47754b),
      ellipse(-2, -5, 3, 12, night ? 0x6b8971 : 0x91ad78, 0.55),
    ]),
    'desert-boulder': art('Boulder', 32, (night) => [
      // Shadow, rock silhouette, and sunlit face.
      ellipse(5, 9, 28, 21, 0x34271e, 0.28),
      polygon(
        [
          [-26, -3],
          [-16, -22],
          [9, -25],
          [27, -10],
          [22, 14],
          [1, 22],
          [-20, 15],
        ],
        night ? 0x786a5c : 0xb49874,
      ),
      polygon(
        [
          [-19, -5],
          [-12, -19],
          [6, -20],
          [15, -11],
          [-3, -2],
        ],
        night ? 0x948373 : 0xd0b58d,
      ),
    ]),
    'desert-rock-cluster': art('Rock cluster', 38, (night) => [
      // Shadow and overlapping stones.
      ellipse(5, 9, 34, 23, 0x34271e, 0.26),
      ellipse(-14, 2, 16, 14, night ? 0x756656 : 0xb0926b),
      ellipse(12, 4, 19, 16, night ? 0x897461 : 0xc3a27a),
      ellipse(0, -11, 14, 13, night ? 0x9a8772 : 0xd3b58a),
    ]),
    'desert-rock-spire': art('Sandstone spire', 30, (night) => [
      // Shadow, spire silhouette, and upper face.
      ellipse(5, 10, 24, 19, 0x34271e, 0.3),
      polygon(
        [
          [-21, 6],
          [-16, -15],
          [-5, -25],
          [11, -21],
          [21, 0],
          [14, 20],
          [-10, 21],
        ],
        night ? 0x8b715d : 0xc89870,
      ),
      polygon(
        [
          [-10, -12],
          [-4, -22],
          [7, -18],
          [12, -5],
          [-3, -3],
        ],
        night ? 0xa38b70 : 0xe0b58b,
      ),
    ]),
  },
  groundArt: (variant, night) => {
    const random = createGroundTileRandom(variant, 0xd35e47)
    const light = night ? 0x9e846a : 0xf9dba5
    const dark = night ? 0x1f2024 : 0x815d3d
    const mid = night ? 0x856e57 : 0xd5a46b
    const shapes = []
    // Broad dune/compacted-sand nap beneath the fine grains.
    for (let i = 0; i < 8; i++) {
      shapes.push(ellipse(random() * 256, random() * 256,
        35 + random() * 48, 11 + random() * 18,
        i % 2 === 0 ? light : dark, night ? 0.055 : 0.065))
    }
    // Broken, wind-aligned ripple crests; the paired shadow gives relief.
    for (let i = 0; i < 45; i++) {
      const x = random() * 256
      const y = random() * 256
      const width = 5 + random() * 19
      shapes.push(ellipse(x, y, width, 0.8 + random() * 0.8, light, 0.27))
      shapes.push(ellipse(x, y + 2.2, width * 0.8, 0.65, dark, 0.19))
    }
    // Sparse granules: a surface material, not generic circles.
    for (let i = 0; i < 310; i++) {
      shapes.push(ellipse(random() * 256, random() * 256,
        0.65 + random() * 1.5, 0.45 + random() * 0.9,
        i % 4 === 0 ? dark : i % 3 === 0 ? light : mid,
        night ? 0.21 : 0.26))
    }
    return shapes
  },
}
