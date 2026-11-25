import { createGroundTileRandom, GROUND_TILE_SIZE } from './groundTexture'

export type OrganicGroundTheme = 'desert' | 'cityscape' | 'kids-room'
type DetailKind = 'sand' | 'gravel' | 'dry-grass' | 'wear' | 'cracks' | 'moss' | 'nap' | 'stain' | 'lint'

interface DetailStyle {
  readonly kind: DetailKind
  readonly day: readonly [string, string]
  readonly night: readonly [string, string]
}

const styles: Record<OrganicGroundTheme, readonly DetailStyle[]> = {
  desert: [
    { kind: 'sand', day: ['#f4d4a0', '#e9c38a'], night: ['#a28d73', '#8f775f'] },
    { kind: 'gravel', day: ['#8b6746', '#e7c79a'], night: ['#463b36', '#a38c76'] },
    { kind: 'dry-grass', day: ['#a18a54', '#d1ba78'], night: ['#605e44', '#92825e'] },
  ],
  cityscape: [
    { kind: 'wear', day: ['#bdb9aa', '#e0dccc'], night: ['#666f70', '#949d99'] },
    { kind: 'cracks', day: ['#55544c', '#a39e90'], night: ['#20292e', '#6c787a'] },
    { kind: 'moss', day: ['#73784f', '#a4a472'], night: ['#414d3e', '#737c56'] },
  ],
  'kids-room': [
    { kind: 'nap', day: ['#7098e0', '#b2caff'], night: ['#4568a3', '#8199c7'] },
    { kind: 'stain', day: ['#23336d', '#594e81'], night: ['#101d42', '#514766'] },
    { kind: 'lint', day: ['#385fae', '#a2b9e3'], night: ['#203d77', '#788db0'] },
  ],
}

export interface GroundDetailPatch {
  readonly kind: DetailKind
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly angle: number
  readonly seed: number
  readonly colors: readonly [string, string]
}

/** Stable composition for the existing eight cached world tile variants.
 * Leave a narrow unmodified edge so adjacent tiles retain the same base phase. */
export function groundDetailPatches(theme: OrganicGroundTheme, variant: number, night: boolean): readonly GroundDetailPatch[] {
  const random = createGroundTileRandom(variant, 0x9d4e71)
  const palette = styles[theme]
  return Array.from({ length: 6 }, (_, index) => {
    const style = palette[index % palette.length]
    if (!style) throw new Error('Missing organic ground detail style')
    const radius = index < 3 ? 48 + random() * 19 : 24 + random() * 17
    const margin = radius + 3
    // Stratify the larger patches, then scatter smaller clusters freely.
    const column = index % 3
    const anchorX = index < 3 ? (column + 0.5) * GROUND_TILE_SIZE / 3 : random() * GROUND_TILE_SIZE
    const x = Math.max(margin, Math.min(GROUND_TILE_SIZE - margin, anchorX + (random() - 0.5) * 45))
    const y = margin + random() * (GROUND_TILE_SIZE - margin * 2)
    return {
      kind: style.kind, x, y, radius, angle: random() * Math.PI * 2,
      seed: Math.floor(random() * 0x7fffffff), colors: night ? style.night : style.day,
    }
  })
}

function ellipse(context: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  context.beginPath()
  context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  context.fill()
}

function softLobe(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, opacity: number): void {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, color + '00')
  context.fillStyle = gradient
  context.globalAlpha = opacity
  ellipse(context, x, y, radius, radius)
}

/** Paint broad, translucent tonal changes plus fine flat surface details.
 * Called only while baking a cached tile, never during rendering or physics. */
export function paintOrganicGround(context: CanvasRenderingContext2D, theme: OrganicGroundTheme, variant: number, night: boolean, padding: number): void {
  for (const patch of groundDetailPatches(theme, variant, night)) {
    const random = createGroundTileRandom(patch.seed, 0x21a5)
    const [base, detail] = patch.colors
    context.save()
    context.translate(padding + patch.x, padding + patch.y)
    context.rotate(patch.angle)
    const r = patch.radius
    const broadOpacity = patch.kind === 'sand' || patch.kind === 'nap' || patch.kind === 'wear' ? 0.48 : 0.31
    softLobe(context, 0, 0, r * 0.82, base, broadOpacity)
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5 + random() * 0.4
      const distance = r * (0.28 + random() * 0.12)
      softLobe(context, Math.cos(angle) * distance, Math.sin(angle) * distance * 0.68,
        r * (0.38 + random() * 0.15), base, broadOpacity * 0.75)
    }

    const count = patch.kind === 'cracks' ? 4 : patch.kind === 'sand' ? 18 : 42
    context.lineCap = 'round'
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2
      const distance = Math.sqrt(random()) * r * 0.62
      const x = Math.cos(angle) * distance
      const y = Math.sin(angle) * distance * 0.72
      context.globalAlpha = 0.18 + random() * 0.32
      context.fillStyle = i % 3 === 0 ? base : detail
      context.strokeStyle = patch.kind === 'cracks' ? base : detail
      switch (patch.kind) {
        case 'gravel':
          ellipse(context, x, y, 0.8 + random() * 2.8, 0.6 + random() * 1.5)
          break
        case 'moss':
          ellipse(context, x, y, 1 + random() * 3, 0.8 + random() * 2)
          break
        case 'wear':
        case 'stain':
          ellipse(context, x, y, 0.6 + random() * 1.4, 0.5 + random() * 1.1)
          break
        case 'cracks': {
          const length = 5 + random() * 8
          context.lineWidth = 0.7 + random() * 0.5
          context.beginPath()
          context.moveTo(x - length, y - 2)
          context.lineTo(x - length * 0.3, y + 1)
          context.lineTo(x + length * 0.3, y - 3)
          context.lineTo(x + length, y + 2)
          context.moveTo(x - length * 0.3, y + 1)
          context.lineTo(x + 2, y + 5)
          context.stroke()
          break
        }
        default: {
          const length = patch.kind === 'sand' ? 5 + random() * 12 : 2 + random() * 5
          context.lineWidth = patch.kind === 'sand' ? 0.8 : 1
          context.beginPath()
          context.moveTo(x - length / 2, y)
          context.quadraticCurveTo(x, y - 1 - random() * 2, x + length / 2, y + 1)
          context.stroke()
        }
      }
    }
    context.restore()
  }
}
