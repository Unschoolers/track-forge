import type { LightingMode } from '@/domain/model'
import { button, element } from '@/ui/dom'
import { clearGlassIllumination, glassOptics, paintGlassIllumination } from '@/ui/menu/glassMaterial'
import type { GlassController, GlassOptions } from '@/vendor/liquidglass/liquid-glass.js'
import sunrise from '@/assets/lighting/sunrise.webp?url'
import sunset from '@/assets/lighting/sunset.webp?url'

const lastFrame = 11
const duration = 1500
const opposite = (lighting: LightingMode): LightingMode => lighting === 'day' ? 'night' : 'day'
const labelFor = (lighting: LightingMode): string => lighting === 'day' ? 'Day' : 'Night'
const sheetFor = (lighting: LightingMode): string => lighting === 'day' ? sunrise : sunset

export function createLightingToggle(lighting: LightingMode, select: (lighting: LightingMode) => void): HTMLButtonElement {
  const toggle = button('', 'lighting-toggle', () => select(opposite(lighting)), 'setup-choice lighting-toggle')
  toggle.dataset.lightingMode = lighting
  toggle.setAttribute('aria-label', 'Night lighting (Day / Night)')
  toggle.setAttribute('aria-pressed', String(lighting === 'night'))
  const sky = element('span', 'lighting-sky')
  sky.setAttribute('aria-hidden', 'true')
  sky.append(element('span', 'lighting-frame'), element('span', 'lighting-frame'))
  const reflection = element('span', 'lighting-reflection')
  reflection.setAttribute('aria-hidden', 'true')
  toggle.append(sky, reflection, element('span', 'lighting-label', labelFor(lighting)))
  return toggle
}

// Both directions share canonical endpoints, so a completed transition and a
// subsequent modal rebuild show the same image.
function paintFrame(layer: HTMLElement, lighting: LightingMode, index: number): void {
  const source = index === 0 ? opposite(lighting) : lighting
  const frame = index === 0 ? lastFrame : index
  const key = source + ':' + frame
  if (layer.dataset.skyFrame === key) return
  layer.dataset.skyFrame = key
  layer.style.backgroundImage = 'url("' + sheetFor(source) + '")'
  layer.style.backgroundPosition = (frame % 4) * 100 / 3 + '% ' + Math.floor(frame / 4) * 50 + '%'
}

function opticsFor(lighting: LightingMode, horizon = false): GlassOptions {
  if (horizon) return { lightAngle: 90, specular: 0.85, specularWidth: 1.8 }
  return lighting === 'day'
    ? { lightAngle: -40, specular: 0.72, specularWidth: 1.5 }
    : { lightAngle: 120, specular: 0.45, specularWidth: 1.5 }
}

type GlassModule = { createGlass: (target: HTMLElement, options: GlassOptions) => GlassController }

/** Owns only decorative pixels. Race state changes synchronously via the native
 * button; the host disposes this short-lived animation on every modal rebuild. */
export function attachLightingArtwork(
  toggle: HTMLButtonElement,
  highQuality: boolean,
  load: () => Promise<GlassModule> = () => import('@/vendor/liquidglass/liquid-glass.js'),
): () => void {
  const sky = toggle.querySelector<HTMLElement>('.lighting-sky')
  const [base, next] = toggle.querySelectorAll<HTMLElement>('.lighting-frame')
  const label = toggle.querySelector<HTMLElement>('.lighting-label')
  if (!sky || !base || !next || !label) return () => undefined

  const lighting = toggle.dataset.lightingMode === 'night' ? 'night' : 'day'
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const animate = toggle.dataset.lightingTransition === 'true' && !motion?.matches
  delete toggle.dataset.lightingTransition
  let disposed = false
  let request: number | undefined
  let glass: GlassController | undefined
  let started: number | undefined
  let stage = -1

  const paint = (progress: number) => {
    const position = progress * lastFrame
    const index = Math.floor(position)
    paintFrame(base, lighting, index)
    // At rest, also load the opposite sheet without displaying it.
    paintFrame(next, lighting, progress === 1 ? 0 : Math.min(lastFrame, index + 1))
    next.style.opacity = String(position - index)
    label.textContent = labelFor(progress < 0.5 ? opposite(lighting) : lighting)
    paintGlassIllumination(toggle, lighting === 'day' ? progress : 1 - progress)
  }
  const applyOptics = (progress: number) => {
    const phase = progress < 0.3 ? 0 : progress < 0.7 ? 1 : 2
    if (phase === stage) return
    stage = phase
    glass?.update(opticsFor(phase === 0 ? opposite(lighting) : lighting, phase === 1))
  }
  const tick = (now: number) => {
    request = undefined
    if (disposed) return
    started ??= now
    const progress = motion?.matches ? 1 : Math.min(1, (now - started) / duration)
    paint(progress)
    applyOptics(progress)
    if (progress < 1) request = requestAnimationFrame(tick)
  }

  paint(animate ? 0 : 1)
  toggle.dataset.lightingArt = ''
  void load().then(module => {
    if (disposed) return
    glass = module.createGlass(sky, {
      fit: true, clip: true, radius: 18, mapScale: 1,
      ...glassOptics('artwork', highQuality),
      ...opticsFor(animate ? opposite(lighting) : lighting),
    })
    // Only three optical maps per interaction; the sprite crossfade is separate.
    stage = animate ? 0 : 2
    if (animate) request = requestAnimationFrame(tick)
  }).catch((error: unknown) => {
    if (disposed) return
    paint(1)
    clearGlassIllumination(toggle)
    delete toggle.dataset.lightingArt
    console.error('LiquidGlass.dev lighting material failed to initialize', error)
  })

  return () => {
    disposed = true
    if (request !== undefined) cancelAnimationFrame(request)
    glass?.destroy()
    paint(1)
    clearGlassIllumination(toggle)
    delete toggle.dataset.lightingArt
  }
}
