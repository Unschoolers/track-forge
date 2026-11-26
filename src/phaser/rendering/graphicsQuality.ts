import type { GraphicsQuality } from '@/application/ports/storage'

/** Render density is independent of world-space zoom and CSS input pixels. */
export function graphicsPixelRatio(quality: GraphicsQuality | undefined, devicePixelRatio: number): number {
  const native = Number.isFinite(devicePixelRatio) ? Math.max(1, devicePixelRatio) : 1
  if (quality === 'low') return 1
  if (quality === 'high') return native
  return Math.min(2, native)
}

export function backingSize(width: number, height: number, ratio: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}
