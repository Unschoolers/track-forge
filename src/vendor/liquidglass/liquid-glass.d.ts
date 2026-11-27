/** Narrow typing for the vendored LiquidGlass.dev content-lens API. */
export interface GlassOptions {
  fit?: boolean
  clip?: boolean
  radius?: number
  refraction?: number
  bezel?: number
  curvature?: number
  ior?: number
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
