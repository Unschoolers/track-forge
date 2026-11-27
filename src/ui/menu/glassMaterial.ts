import type { GlassOptions } from '@/vendor/liquidglass/liquid-glass.js'

type GlassKind = 'action' | 'group' | 'artwork'

/** Shared optical geometry. A circular profile spreads the bend through the
 * shoulder of the glass instead of concentrating it into a thin white rim. */
export function glassOptics(kind: GlassKind, highQuality: boolean): GlassOptions {
  return {
    refraction: kind === 'artwork' ? 32 : kind === 'group' ? 22 : 26,
    bezel: kind === 'group' ? 0.85 : 1,
    curvature: 2,
    ior: 1.6,
    chroma: highQuality ? 0.08 : 0,
    blur: 0,
    specular: 0.72,
    specularWidth: 1.5,
  }
}

/** Continuous light over a day/night artwork transition. This is a paint-only
 * reflection, not a displacement map update. The endpoint is direction independent. */
export function paintGlassIllumination(surface: HTMLElement, daylight: number): void {
  const day = Math.max(0, Math.min(1, daylight))
  const horizon = Math.sin(Math.PI * day)
  surface.style.setProperty('--glass-light-x', (82 - 54 * day) + '%')
  surface.style.setProperty('--glass-light-y', (72 - 64 * day + 25 * horizon) + '%')
  surface.style.setProperty('--glass-light-color', 'rgb(255 ' + Math.round(228 - 60 * horizon) + ' ' + Math.round(207 - 102 * horizon) + ' / ' + (0.13 + 0.23 * horizon + 0.09 * day) + ')')
  surface.style.setProperty('--glass-ambient', 'rgb(' + Math.round(120 + 135 * Math.max(day, horizon)) + ' ' + Math.round(165 - 40 * horizon) + ' ' + Math.round(240 - 155 * Math.max(day, horizon)) + ' / ' + (0.12 + 0.24 * horizon) + ')')
}

export function clearGlassIllumination(surface: HTMLElement): void {
  for (const name of ['--glass-light-x', '--glass-light-y', '--glass-light-color', '--glass-ambient']) {
    surface.style.removeProperty(name)
  }
}
