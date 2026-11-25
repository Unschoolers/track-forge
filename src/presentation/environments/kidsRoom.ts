import { art, ellipse, polygon } from './artPrimitives'
import type { SceneryPrimitive, TrackEnvironmentDefinition } from './types'

const rectangle = (x: number, y: number, width: number, height: number, color: number): SceneryPrimitive =>
  polygon([[x, y], [x + width, y], [x + width, y + height], [x, y + height]], color)

/**
 * A tiny racing world laid out on a bedroom carpet. Props are built from the
 * same bounded vector primitives as existing environments, so race, editor and
 * flyover all render identical silhouettes without additional assets.
 */
export const KIDS_ROOM_ENVIRONMENT: TrackEnvironmentDefinition = {
  label: "Kids' Room",
  day: {
    editorGround: '#2651b1',
    raceGround: '#2651b1',
    flyoverGround: '#2651b1',
    hillSlope: 0x9d5060,
    hillPlateau: 0xb66b72,
    flyoverHill: '#b66b72',
    shorelineLand: 0x524173,
    waterFill: 0xb14e68,
    waterRipple: 0xefb1bd,
    waterShoreline: 0xffdfdb,
    flyoverWater: '#b14e68',
  },
  night: {
    editorGround: '#122858',
    raceGround: '#122858',
    flyoverGround: '#122858',
    hillSlope: 0x543045,
    hillPlateau: 0x79465c,
    flyoverHill: '#79465c',
    shorelineLand: 0x332847,
    waterFill: 0x6c3453,
    waterRipple: 0xd090a5,
    waterShoreline: 0xeac1c8,
    flyoverWater: '#6c3453',
  },
  scenery: {
    'kids-blocks': art('Alphabet blocks', 37, (night) => [
      ellipse(6, 11, 34, 24, 0x201b23, 0.25),
      rectangle(-31, -16, 26, 26, night ? 0x895b55 : 0xde7163),
      rectangle(-29, -14, 21, 21, night ? 0xb78c80 : 0xf5b6a3),
      rectangle(-3, -28, 28, 28, night ? 0x3c7290 : 0x62b5d6),
      rectangle(0, -25, 22, 22, night ? 0x78a1ae : 0xc6e7eb),
      rectangle(0, 4, 29, 26, night ? 0x9e8744 : 0xf4cf67),
      rectangle(3, 7, 22, 19, night ? 0xceb777 : 0xffe3a0),
      rectangle(-22, -7, 7, 4, night ? 0x734c47 : 0xa34338),
      rectangle(8, -16, 5, 12, night ? 0x467089 : 0x3884a8),
      rectangle(10, 12, 10, 4, night ? 0x86743c : 0xa97e31),
    ]),
    'kids-teddy': art('Teddy bear', 48, (night) => [
      ellipse(6, 11, 43, 30, 0x201b23, 0.27),
      ellipse(-27, -20, 14, 14, night ? 0x785a55 : 0xb67b58),
      ellipse(26, -20, 14, 14, night ? 0x785a55 : 0xb67b58),
      ellipse(0, 14, 29, 25, night ? 0x856759 : 0xc9946b),
      ellipse(0, -11, 30, 27, night ? 0x9b7766 : 0xdba77d),
      ellipse(0, 0, 14, 12, night ? 0xb7a093 : 0xf3d5b2),
      ellipse(-11, -15, 3, 4, 0x27252b),
      ellipse(11, -15, 3, 4, 0x27252b),
      ellipse(0, -2, 5, 4, night ? 0x29242b : 0x513b34),
      ellipse(-20, 24, 11, 9, night ? 0x785a55 : 0xb67b58),
      ellipse(20, 24, 11, 9, night ? 0x785a55 : 0xb67b58),
    ]),
    'kids-crayons': art('Crayons', 33, (night) => [
      ellipse(4, 9, 31, 20, 0x201b23, 0.2),
      polygon([[-29, 10], [-22, -21], [-15, -19], [-22, 12]], night ? 0x9e4e54 : 0xee5660),
      polygon([[-22, -21], [-18, -29], [-15, -19]], night ? 0xc8a88d : 0xf6d7a7),
      polygon([[-6, 15], [1, -18], [9, -16], [2, 17]], night ? 0x3d749b : 0x58b5e0),
      polygon([[1, -18], [6, -27], [9, -16]], night ? 0xc8a88d : 0xf6d7a7),
      polygon([[12, 13], [29, -9], [34, -4], [17, 18]], night ? 0xb38f4b : 0xf5d15e),
      polygon([[29, -9], [37, -13], [34, -4]], night ? 0xc8a88d : 0xf6d7a7),
    ]),
    'kids-book': art('Picture book', 43, (night) => [
      ellipse(5, 10, 41, 31, 0x201b23, 0.24),
      polygon([[-38, -25], [-1, -22], [1, 26], [-36, 22]], night ? 0x586c90 : 0x83b8e4),
      polygon([[1, -22], [38, -25], [36, 22], [1, 26]], night ? 0xa37878 : 0xf3b2b0),
      polygon([[-31, -19], [-5, -16], [-4, 18], [-29, 17]], night ? 0xc1c3bc : 0xffefdb),
      polygon([[5, -16], [31, -19], [29, 17], [4, 18]], night ? 0xc1c3bc : 0xffefdb),
      ellipse(-17, -3, 9, 9, night ? 0x66826b : 0x8ac58c),
      polygon([[12, 6], [20, -11], [26, 7]], night ? 0x967f4d : 0xefc65c),
      rectangle(-1, -22, 2, 47, night ? 0x77757b : 0xa48d95),
    ]),
    'kids-dinosaur': art('Toy dinosaur', 49, (night) => [
      ellipse(7, 12, 43, 26, 0x201b23, 0.25),
      polygon([[-39, 17], [-23, 0], [-7, -13], [17, -12], [26, -24], [35, -16], [29, 2], [39, 11], [15, 22], [-4, 13], [-22, 24]], night ? 0x437c64 : 0x53a578),
      polygon([[-14, -11], [-7, -22], [0, -11], [7, -21], [13, -10]], night ? 0x6b9371 : 0x99d18c),
      polygon([[-5, 13], [1, 29], [12, 30], [12, 12]], night ? 0x437c64 : 0x53a578),
      ellipse(28, -11, 3, 3, 0x222d29),
      ellipse(29, -12, 1, 1, 0xffffff),
    ]),
    'kids-top': art('Spinning top', 28, (night) => [
      ellipse(5, 9, 26, 19, 0x201b23, 0.25),
      ellipse(0, 0, 24, 22, night ? 0x3f8094 : 0x5ac0d5),
      ellipse(0, 0, 19, 17, night ? 0xb28b54 : 0xf2c75f),
      ellipse(0, 0, 13, 12, night ? 0xb05e65 : 0xee7f7c),
      ellipse(0, 0, 6, 5, night ? 0xddd3bd : 0xfff0c9),
    ]),
  },
  groundArt: (variant, night) => {
    // Pre-bake directional yarn pile rather than sprinkling a few dots on
    // a flat fill. The same bounded tile art is used by editor, race and flyover.
    const shapes: SceneryPrimitive[] = []
    const fiberLight = night ? 0x6181c5 : 0x9fc8ff
    const fiberMid = night ? 0x36579d : 0x5d8fe9
    const fiberDark = night ? 0x06142f : 0x153888
    const hash = (seed: number) => {
      let value = Math.imul(seed ^ Math.imul(variant + 1, 0x9e3779b1), 0x85ebca6b)
      value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
      return (value ^ (value >>> 16)) >>> 0
    }
    // Broad nap variations show at race zoom; they remain blue, never sandy.
    for (let patch = 0; patch < 7; patch += 1) {
      const seed = hash(patch + 2901)
      const x = seed & 255
      const y = (seed >>> 8) & 255
      shapes.push(ellipse(x, y, 28 + ((seed >>> 16) % 36), 14 + ((seed >>> 21) % 21),
        patch % 2 ? fiberDark : fiberLight, night ? 0.045 : 0.06))
    }
    // Fine lengthwise loops and alternating shade mimic short woven carpet
    // fibers. Geometry is deterministic and drawn only once per tile variant.
    for (let index = 0; index < 520; index += 1) {
      const seed = hash(index + 19)
      const x = seed & 255
      const y = (seed >>> 8) & 255
      const length = 2.5 + ((seed >>> 16) % 6)
      const width = 0.8 + ((seed >>> 23) % 3) * 0.45
      const color = index % 5 === 0 ? fiberDark : index % 3 === 0 ? fiberLight : fiberMid
      shapes.push(ellipse(x, y, width, length, color, night ? 0.20 : 0.28))
    }
    // Very subtle regular cross-weave sells the material without a tile grid.
    for (let row = 0; row < 32; row += 1) {
      for (let column = 0; column < 16; column += 1) {
        const seed = hash(800 + row * 16 + column)
        const x = column * 16 + (row % 2) * 5 + ((seed >>> 6) % 5)
        const y = row * 8 + ((seed >>> 15) % 3)
        shapes.push(ellipse(x, y, 3.2, 0.8, row % 3 === 0 ? fiberDark : fiberLight,
          night ? 0.095 : 0.11))
      }
    }
    return shapes
  },
}
