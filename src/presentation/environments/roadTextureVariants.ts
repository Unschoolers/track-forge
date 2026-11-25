/** Three deterministic, smoothly joined variations of a seamless road swatch.
 * Keep the longitudinal grain direction: mirror/offset, never rotate by 90°. */
export const ROAD_TEXTURE_VARIANTS = 3

export function buildRoadTextureStrip(source: Uint8ClampedArray, size: number): Uint8ClampedArray {
  if (!Number.isInteger(size) || size < 8 || source.length !== size * size * 4) {
    throw new Error('Invalid road material swatch')
  }
  const strip = new Uint8ClampedArray(source.length * ROAD_TEXTURE_VARIANTS)
  const fade = Math.max(2, Math.floor(size / 8))
  const half = Math.floor(size / 2)
  const third = Math.floor(size / 3)

  const channel = (x: number, y: number, c: number): number => {
    const value = source[((y % size) * size + x % size) * 4 + c]
    if (value === undefined) throw new Error('Road material sample outside swatch')
    return value
  }
  const sample = (variant: number, x: number, y: number, c: number): number => {
    if (variant === 0) return channel(x, y, c)
    if (variant === 1) return channel(size - 1 - x, y + third, c)
    // A quieter variation: blend two shifted versions to break up distinctive
    // sand patches, repairs and tire marks without changing the road palette.
    return channel(x + half, y + half, c) * 0.65 +
      channel(size - 1 - x, y + third * 2, c) * 0.35
  }

  for (let variant = 0; variant < ROAD_TEXTURE_VARIANTS; variant++) {
    for (let y = 0; y < size; y++) {
      const fromStart = y
      const fromEnd = size - 1 - y
      const neighbor = fromStart < fromEnd
        ? (variant + ROAD_TEXTURE_VARIANTS - 1) % ROAD_TEXTURE_VARIANTS
        : (variant + 1) % ROAD_TEXTURE_VARIANTS
      const t = Math.min(1, Math.min(fromStart, fromEnd) / fade)
      const mix = 0.5 * (1 - t * t * (3 - 2 * t))
      for (let x = 0; x < size; x++) {
        for (let c = 0; c < 4; c++) {
          const value = sample(variant, x, y, c)
          strip[((variant * size + y) * size + x) * 4 + c] =
            value * (1 - mix) + sample(neighbor, x, y, c) * mix
        }
      }
    }
  }
  return strip
}

/** Fit whole strips on closed circuits; preserve the nominal scale on open routes. */
export function roadTextureRepeat(length: number, closed: boolean): number {
  const nominal = 96 * ROAD_TEXTURE_VARIANTS
  return closed && length > 0
    ? length / Math.max(1, Math.round(length / nominal)) / ROAD_TEXTURE_VARIANTS
    : 96
}
