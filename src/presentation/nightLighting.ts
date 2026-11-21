/**
 * Shared pre-race and gameplay headlight asset. Environment/road textures are
 * already night-tinted, so no second fullscreen darkening overlay is needed.
 */
export const NIGHT_HEADLIGHT = {
  width: 164,
  height: 92,
  sourceX: 6,
  carFrontX: 17,
  farX: 156,
  nearHalfWidth: 7,
  farHalfWidth: 38,
} as const

let cachedBeam: HTMLCanvasElement | undefined

/** Build once and reuse; no gradients or meshes allocated on race frames. */
export function getNightHeadlightBeam(): HTMLCanvasElement {
  if (cachedBeam) return cachedBeam

  const canvas = document.createElement('canvas')
  canvas.width = NIGHT_HEADLIGHT.width
  canvas.height = NIGHT_HEADLIGHT.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create night headlight texture')

  ctx.save()
  ctx.translate(0, canvas.height / 2)
  // A single continuous cone with feathered edges, not overlapping triangles.
  // The same raster is drawn by the flyover and uploaded once in Phaser.
  ctx.filter = 'blur(2px)'
  const gradient = ctx.createLinearGradient(
    NIGHT_HEADLIGHT.sourceX, 0, NIGHT_HEADLIGHT.farX, 0,
  )
  gradient.addColorStop(0, 'rgba(255, 235, 160, 0.48)')
  gradient.addColorStop(0.48, 'rgba(255, 235, 160, 0.21)')
  gradient.addColorStop(1, 'rgba(255, 235, 160, 0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.moveTo(NIGHT_HEADLIGHT.sourceX, -NIGHT_HEADLIGHT.nearHalfWidth)
  ctx.lineTo(NIGHT_HEADLIGHT.farX, -NIGHT_HEADLIGHT.farHalfWidth)
  ctx.lineTo(NIGHT_HEADLIGHT.farX, NIGHT_HEADLIGHT.farHalfWidth)
  ctx.lineTo(NIGHT_HEADLIGHT.sourceX, NIGHT_HEADLIGHT.nearHalfWidth)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  cachedBeam = canvas
  return canvas
}
