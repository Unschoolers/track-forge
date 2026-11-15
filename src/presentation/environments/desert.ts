import { art, ellipse, polygon } from './artPrimitives'
import type { TrackEnvironmentDefinition } from './types'

export const DESERT_ENVIRONMENT: TrackEnvironmentDefinition = {
  label: 'Desert',
  day: {
    editorGround: '#bd9d6b',
    raceGround: '#bd9d6b',
    flyoverGround: '#c2a77c',
    hillSlope: 0xa8865d,
    hillPlateau: 0xd0b081,
    flyoverHill: '#d6ba8d',
    shorelineLand: 0xd2bd91,
  },
  night: {
    editorGround: '#403b38',
    raceGround: '#3c3734',
    flyoverGround: '#49433f',
    hillSlope: 0x5b5147,
    hillPlateau: 0x736454,
    flyoverHill: '#776b5e',
    shorelineLand: 0x817568,
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
    const shift = (variant % 4) * 22
    const light = night ? 0xceb99a : 0xe5c999
    const dark = night ? 0x221b19 : 0x8c6d4d
    return [
      ellipse(60 + shift, 56, 78, 23, light, 0.045),
      ellipse(195 - shift, 180, 90, 28, dark, 0.035),
      ellipse(100 + shift, 112, 48, 4, light, 0.06),
      ellipse(174 - shift, 214, 54, 4, light, 0.05),
    ]
  },
}
