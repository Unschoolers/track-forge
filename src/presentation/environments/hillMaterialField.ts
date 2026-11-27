/** Static, world-aligned material field. Four-world-unit samples and a
 * two-pass separable blur smooth the authored mesh without touching physics.
 * Padding covers both blur passes, so neighboring tiles agree at their edges. */
export const HILL_FIELD_STEP = 4
const BLUR_RADIUS = 3
// Two extra samples cover the interpolation neighbors on both sides of a
// tile seam after both blur passes in each axis.
export const HILL_FIELD_PADDING = HILL_FIELD_STEP * (BLUR_RADIUS * 2 + 2)

export function smoothHillField(input: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || input.length !== width * height * 4) {
    throw new RangeError('Invalid hill material field dimensions')
  }
  let source = input.slice()
  // Store premultiplied values so transparent pixels do not contribute shade.
  for (let i = 0; i < source.length; i += 4) {
    const alpha = (source[i + 3] ?? 0) / 255
    for (let channel = 0; channel < 3; channel++) {
      source[i + channel] = (source[i + channel] ?? 0) * alpha
    }
  }
  let target = new Uint8ClampedArray(source.length)
  for (let pass = 0; pass < 4; pass++) {
    const horizontal = pass % 2 === 0
    const lines = horizontal ? height : width
    const length = horizontal ? width : height
    const stride = horizontal ? 4 : width * 4
    for (let line = 0; line < lines; line++) {
      const base = line * (horizontal ? width * 4 : 4)
      for (let channel = 0; channel < 4; channel++) {
        const at = (position: number): number =>
          source[base + Math.max(0, Math.min(length - 1, position)) * stride + channel] ?? 0
        let sum = 0
        for (let offset = -BLUR_RADIUS; offset <= BLUR_RADIUS; offset++) sum += at(offset)
        for (let position = 0; position < length; position++) {
          target[base + position * stride + channel] = sum / (BLUR_RADIUS * 2 + 1)
          sum += at(position + BLUR_RADIUS + 1) - at(position - BLUR_RADIUS)
        }
      }
    }
    const previous = source
    source = target
    target = previous
  }
  return source
}

/** Convert blurred coverage into a feathered foot and a continuous material
 * mix. Keep the plateau opaque away from the boundary. */
export function hillMaterialWeights(field: Uint8ClampedArray, offset: number): {
  readonly coverage: number; readonly rock: number; readonly light: number; readonly shadow: number
} {
  const alpha = field[offset + 3] ?? 0
  if (alpha === 0) return { coverage: 0, rock: 0, light: 0, shadow: 0 }
  const edge = Math.max(0, Math.min(1, (alpha / 255 - 0.42) / 0.48))
  return {
    coverage: edge * edge * (3 - 2 * edge),
    rock: Math.min(1, (field[offset] ?? 0) / alpha),
    light: Math.min(1, (field[offset + 1] ?? 0) / alpha),
    shadow: Math.min(1, (field[offset + 2] ?? 0) / alpha),
  }
}
