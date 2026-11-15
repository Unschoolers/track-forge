import { art, ellipse, polygon } from './artPrimitives'
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
    flyoverGround: '#888c86',
    hillSlope: 0x777f79,
    hillPlateau: 0x969b91,
    flyoverHill: '#a2a79b',
    shorelineLand: 0xa8a99a,
  },
  night: {
    editorGround: '#292f35',
    raceGround: '#252b31',
    flyoverGround: '#30383d',
    hillSlope: 0x39444a,
    hillPlateau: 0x4b5759,
    flyoverHill: '#4b5658',
    shorelineLand: 0x64716e,
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
  groundArt: (_variant, night) => {
    const color = night ? 0xadb7b0 : 0x394841
    return [
      polygon(
        [
          [0, 63],
          [256, 63],
          [256, 64],
          [0, 64],
        ],
        color,
        0.09,
      ),
      polygon(
        [
          [0, 191],
          [256, 191],
          [256, 192],
          [0, 192],
        ],
        color,
        0.09,
      ),
      polygon(
        [
          [63, 0],
          [64, 0],
          [64, 256],
          [63, 256],
        ],
        color,
        0.07,
      ),
      polygon(
        [
          [191, 0],
          [192, 0],
          [192, 256],
          [191, 256],
        ],
        color,
        0.07,
      ),
    ]
  },
}
