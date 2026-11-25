import { createGroundTileRandom, GROUND_TILE_SIZE, type GroundTile } from './groundTexture'

interface OilSlick {
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly rotation: number
  readonly stretch: number
}

/** World-space clusters are deterministic across adjacent cached tiles.
 * A slick can extend over a tile boundary, so both tiles sample the same
 * neighboring seeds rather than restarting a local random pattern. */
export function harborOilSlicks(tile: Pick<GroundTile, 'x' | 'y'>): readonly OilSlick[] {
  const size = GROUND_TILE_SIZE
  const result: OilSlick[] = []
  for (let y = tile.y - 1; y <= tile.y + 1; y++) {
    for (let x = tile.x - 1; x <= tile.x + 1; x++) {
      const seed = Math.imul(x, 73856093) ^ Math.imul(y, 19349663)
      const random = createGroundTileRandom(seed, 0x01c51c)
      if (random() > 0.64) continue
      const cx = (x + random()) * size
      const cy = (y + random()) * size
      const radius = 25 + random() * 31
      const rotation = random() * Math.PI * 2
      const stretch = 0.38 + random() * 0.28
      const reach = radius * 1.65
      if (cx + reach < tile.x * size || cx - reach > (tile.x + 1) * size ||
          cy + reach < tile.y * size || cy - reach > (tile.y + 1) * size) continue
      result.push({ x: cx, y: cy, radius, rotation, stretch })
    }
  }
  return result
}

/** Called inside the existing water clip, never over roads or land.
 * Soft overlapping lobes keep the center nearly black and add a restrained
 * blue-purple sheen at the thinning edge. Baked only on tile creation. */
export function paintHarborOilSlicks(context: CanvasRenderingContext2D, tile: Pick<GroundTile, 'x' | 'y'>): void {
  for (const slick of harborOilSlicks(tile)) {
    context.save()
    context.translate(slick.x, slick.y)
    context.rotate(slick.rotation)
    context.scale(1, slick.stretch)
    const radius = slick.radius
    for (const [x, y, scale] of [[0, 0, 1], [-0.53, 0.20, 0.57], [0.52, -0.13, 0.64]] as const) {
      const r = radius * scale
      const cx = x * radius
      const cy = y * radius
      const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, r)
      gradient.addColorStop(0, 'rgba(8,12,20,0.79)')
      gradient.addColorStop(0.55, 'rgba(10,15,25,0.64)')
      gradient.addColorStop(0.82, 'rgba(65,50,94,0.24)')
      gradient.addColorStop(0.94, 'rgba(87,142,153,0.10)')
      gradient.addColorStop(1, 'rgba(87,142,153,0)')
      context.fillStyle = gradient
      context.fillRect(cx - r, cy - r, 2 * r, 2 * r)
    }
    context.restore()
  }
}
