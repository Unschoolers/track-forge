/** Narrow typing for the vendored LiquidGlass.dev optical API. */
export const engine: 'blink' | 'webkit' | 'gecko' | 'unknown'
export interface GlassOptions {
  mode?: 'content' | 'backdrop'
  fallback?: string
  fit?: boolean
  clip?: boolean
  radius?: number
  refraction?: number
  bezel?: number
  curvature?: number
  chroma?: number
  blur?: number
  specular?: number
  specularWidth?: number
  lightAngle?: number
  mapScale?: number
}

export interface GlassController {
  update(options: Partial<GlassOptions>): void
  destroy(): void
}

export function createGlass(target: HTMLElement, options?: GlassOptions): GlassController
