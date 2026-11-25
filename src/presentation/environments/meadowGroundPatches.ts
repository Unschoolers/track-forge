import { GROUND_TILE_SIZE, createGroundTileRandom } from './groundTexture'

export interface MeadowGroundMark {
  readonly x: number
  readonly y: number
  readonly radiusX: number
  readonly radiusY: number
  readonly color: number
  readonly alpha: number
}

/** Decorative groundcover, not solid scenery: safe underneath an authored
 * road, water or collision prop. The existing padded tile cache bakes this
 * once; all lobes fit inside its 64-unit gutter, even at tile boundaries. */
export function meadowGroundPatches(variant: number, night: boolean): readonly MeadowGroundMark[] {
  const random = createGroundTileRandom(variant, 0x671ead)
  const marks: MeadowGroundMark[] = []
  const paint = (x: number, y: number, radiusX: number, radiusY: number, color: number, alpha: number) =>
    marks.push({ x, y, radiusX, radiusY, color, alpha })

  for (let patch = 0; patch < 4; patch++) {
    const x = random() * GROUND_TILE_SIZE
    const y = random() * GROUND_TILE_SIZE
    const rx = 19 + random() * 16
    const ry = 12 + random() * 12
    const angle = random() * Math.PI * 2
    const mud = patch === 0
    const flowers = patch === 1
    const shadow = mud ? (night ? 0x302d22 : 0x76603b) : (night ? 0x142f1c : 0x214a29)
    const mid = mud ? (night ? 0x51432e : 0xa58b56) : (night ? 0x294b26 : 0x557d32)
    const light = mud ? (night ? 0x685638 : 0xc0a16c) : (night ? 0x476133 : 0x89a94c)
    // Overlapping soft-edged lobes form irregular patches instead of stamps
    // with rectangular boundaries. Ground stays visible through the edges.
    paint(x, y, rx + 5, ry + 5, shadow, 0.2)
    for (let lobe = 0; lobe < 7; lobe++) {
      const a = angle + lobe * Math.PI * 2 / 7
      const px = x + Math.cos(a) * rx * 0.48
      const py = y + Math.sin(a) * ry * 0.48
      paint(px, py, rx * (0.38 + random() * 0.2), ry * (0.38 + random() * 0.2), shadow, 0.34)
      paint(px - 2, py - 2, rx * 0.37, ry * 0.4, mid, 0.58)
    }
    for (let blade = 0; blade < 28; blade++) {
      const a = random() * Math.PI * 2
      const r = Math.sqrt(random())
      const px = x + Math.cos(a) * rx * r
      const py = y + Math.sin(a) * ry * r
      if (mud) {
        paint(px, py, 0.7 + random() * 1.8, 0.6 + random() * 1.1, blade % 3 ? light : shadow, 0.48)
      } else {
        paint(px + 1, py + 1, 2.6, 3.8, shadow, 0.65)
        paint(px, py - 1, 1.4 + random(), 2.8 + random() * 2, blade % 3 ? mid : light, 0.84)
      }
      if (flowers && blade % 3 === 0) {
        const petal = night ? 0xc4c6a0 : (blade % 2 ? 0xffe9a1 : 0xfff2db)
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 2 / 5
          paint(px + Math.cos(a) * 1.7, py + Math.sin(a) * 1.7, 1.15, 1.15, petal, 0.94)
        }
        paint(px, py, 0.9, 0.9, night ? 0xa58a46 : 0xe5b641, 1)
      }
    }
  }
  return marks
}
