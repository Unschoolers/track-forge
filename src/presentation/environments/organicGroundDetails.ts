import { createGroundTileRandom, GROUND_TILE_SIZE } from './groundTexture'

export type OrganicGroundTheme = 'desert' | 'cityscape' | 'kids-room'
const salts: Record<OrganicGroundTheme, number> = {
  desert: 0x9d4e71, cityscape: 0x2a3719, 'kids-room': 0x723ad1,
}

interface GroundDetailPatch {
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly angle: number
}

/** Bounded, deterministic placement of the baked transparent artwork.
 * Day and night share the exact geometry. Keep the entire rotated image
 * within the central tile to avoid drawing over a neighboring tile. */
export function groundDetailPatches(theme: OrganicGroundTheme, variant: number): readonly GroundDetailPatch[] {
  const random = createGroundTileRandom(variant, salts[theme])
  // Carpet stars are recognizable motifs, unlike diffuse natural patches.
  // Keep them sparse and smaller so the blue carpet remains the dominant material.
  const carpet = theme === 'kids-room'
  return Array.from({ length: carpet ? 2 : 6 }, (_, index) => {
    const radius = carpet ? 24 + random() * 16 : index < 3 ? 48 + random() * 19 : 24 + random() * 17
    const margin = radius + 3
    const column = index % 3
    const anchorX = carpet
      ? (index + 0.5) * GROUND_TILE_SIZE / 2
      : index < 3 ? (column + 0.5) * GROUND_TILE_SIZE / 3 : random() * GROUND_TILE_SIZE
    const x = Math.max(margin, Math.min(GROUND_TILE_SIZE - margin, anchorX + (random() - 0.5) * 45))
    const y = margin + random() * (GROUND_TILE_SIZE - margin * 2)
    return { x, y, radius, angle: random() * Math.PI * 2 }
  })
}

export function paintOrganicGround(context: CanvasRenderingContext2D, theme: OrganicGroundTheme, variant: number, image: HTMLCanvasElement, padding: number): void {
  for (const patch of groundDetailPatches(theme, variant)) {
    // A square with this half-side has circumscribed radius patch.radius.
    const half = patch.radius / Math.SQRT2
    context.save()
    context.translate(padding + patch.x, padding + patch.y)
    context.rotate(patch.angle)
    context.drawImage(image, -half, -half, half * 2, half * 2)
    context.restore()
  }
}
