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
    editorGround: '#b6a899',
    raceGround: '#b6a899',
    flyoverGround: '#b9aa9c',
    hillSlope: 0x998678,
    hillPlateau: 0xc8b5a4,
    flyoverHill: '#c8b5a4',
    shorelineLand: 0xbb9a79,
    waterFill: 0xd99036,
    waterRipple: 0xffcf74,
    waterShoreline: 0xf4be65,
    flyoverWater: '#d99036',
  },
  night: {
    editorGround: '#423e47',
    raceGround: '#423e47',
    flyoverGround: '#47424b',
    hillSlope: 0x4b4653,
    hillPlateau: 0x665965,
    flyoverHill: '#665965',
    shorelineLand: 0x907053,
    waterFill: 0x80501f,
    waterRipple: 0xc99050,
    waterShoreline: 0xba8349,
    flyoverWater: '#80501f',
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
    // Fine, softly varied woven threads baked once per tile and lighting mode.
    // Small marks avoid competing with the actual track or miniature props.
    const shapes: SceneryPrimitive[] = []
    const light = night ? 0x91848f : 0xe7d4bc
    const dark = night ? 0x1d2833 : 0x88796e
    for (let index = 0; index < 36; index += 1) {
      const x = ((index * 79 + variant * 31) % 252) + 2
      const y = ((index * 53 + variant * 47) % 252) + 2
      shapes.push(ellipse(x, y, 1.2 + (index % 3), 3.5 + (index % 4), index % 3 === 0 ? dark : light, night ? 0.14 : 0.19))
    }
    // Barely perceptible weave bands give the carpet some directional pile.
    for (let band = 0; band < 3; band += 1) {
      const y = 24 + band * 86
      shapes.push(rectangle(0, y, 256, 2, dark))
      // Tint is applied with the alpha-aware scenery contract below.
      const last = shapes[shapes.length - 1]
      if (last) shapes[shapes.length - 1] = { ...last, alpha: 0.035 }
    }
    return shapes
  },
}
