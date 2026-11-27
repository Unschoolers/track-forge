import type { CarId, LightingMode, Track } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { createRaceFlyoverRenderer } from '@/ui/components/raceFlyoverRenderer'
import { button, element } from '@/ui/dom'

const FRAME_INTERVAL_MS = 32
const DEFAULT_SPEED = 2
const FAST_SPEED = 4
type PlaybackSpeed = 0 | typeof DEFAULT_SPEED | typeof FAST_SPEED

export interface RaceFlyoverPlayback {
  elapsedSeconds: number
  speed?: PlaybackSpeed
}

export function createRaceFlyover(
  track: Track,
  geometry: TrackGeometry,
  car: CarId,
  lighting: LightingMode,
  ghost: boolean,
  playback: RaceFlyoverPlayback,
  lowQuality = false,
) {
  const panel = element('div', 'race-flyover-panel')
  const canvas = element('canvas', 'race-flyover')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', `${lighting === 'night' ? 'Nighttime' : 'Daytime'} flyover of ${track.name}`)
  canvas.dataset.car = car
  canvas.dataset.lighting = lighting
  let paint = createRaceFlyoverRenderer(geometry, track, car, lighting, ghost, lowQuality)
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let speed: PlaybackSpeed = playback.speed ?? (motion?.matches ? 0 : DEFAULT_SPEED)
  let visible = true
  let frame: number | undefined
  let lastFrame: number | undefined
  const toggle = button('', 'toggle-race-flyover', () => {
    playback.speed = speed === 0 ? DEFAULT_SPEED : speed === DEFAULT_SPEED ? FAST_SPEED : 0
    setSpeed(playback.speed)
  }, 'race-flyover-toggle')
  panel.append(canvas, toggle)

  function schedule(): void {
    if (frame !== undefined || !visible || document.hidden) return
    frame = window.requestAnimationFrame(draw)
  }

  function draw(now: number): void {
    frame = undefined
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height || !canvas.isConnected) return
    const context = canvas.getContext('2d')
    if (!context) return
    const dt = lastFrame === undefined ? 0 : now - lastFrame
    if (lastFrame === undefined || dt >= FRAME_INTERVAL_MS || speed === 0) {
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
      const pixelWidth = Math.round(width * pixelRatio)
      const pixelHeight = Math.round(height * pixelRatio)
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      playback.elapsedSeconds += Math.min(dt, 100) * speed / 1000
      paint(context, width, height, playback.elapsedSeconds)
      lastFrame = now
    }
    if (speed !== 0) schedule()
  }

  function refresh(): void {
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    frame = undefined
    lastFrame = undefined
    schedule()
  }

  function setSpeed(value: PlaybackSpeed): void {
    speed = value
    const label = speed === 0 ? 'Play flyover'
      : speed === DEFAULT_SPEED ? 'Double flyover speed' : 'Pause flyover'
    toggle.setAttribute('aria-label', label)
    toggle.title = label
    toggle.textContent = speed === DEFAULT_SPEED ? '2×' : ''
    toggle.classList.toggle('speed-up', speed === DEFAULT_SPEED)
    toggle.classList.toggle('playing', speed === FAST_SPEED)
    refresh()
  }

  const onMotionChange = () => {
    delete playback.speed
    setSpeed(motion?.matches ? 0 : DEFAULT_SPEED)
  }
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(refresh)
  const intersection = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false
    refresh()
  })
  resize?.observe(canvas)
  intersection?.observe(canvas)
  motion?.addEventListener('change', onMotionChange)
  document.addEventListener('visibilitychange', refresh)
  setSpeed(speed)
  return {
    element: panel,
    setPresentation(car: CarId, lighting: LightingMode, ghost: boolean, nextLowQuality = lowQuality): void {
      lowQuality = nextLowQuality
      paint = createRaceFlyoverRenderer(geometry, track, car, lighting, ghost, lowQuality)
      canvas.dataset.car = car
      canvas.dataset.lighting = lighting
      canvas.setAttribute('aria-label', (lighting === 'night' ? 'Nighttime' : 'Daytime') + ' flyover of ' + track.name)
      // Keep existing pixels visible until the next frame is ready.
      refresh()
    },
    destroy(): void {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      resize?.disconnect()
      intersection?.disconnect()
      motion?.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', refresh)
    },
  }
}


/** Retain the canvas, prepared materials and observers across unrelated UI renders. */
export class RaceFlyoverLifecycle {
  private key: string | undefined
  private playback: RaceFlyoverPlayback = { elapsedSeconds: 0 }
  private current: {
    track: Track; geometry: TrackGeometry; car: CarId; lighting: LightingMode; ghost: boolean; lowQuality: boolean
    view: ReturnType<typeof createRaceFlyover>
  } | undefined
  private used = false

  begin(key: string | undefined): void {
    this.used = false
    if (key !== this.key) {
      this.release()
      this.key = key
      this.playback = { elapsedSeconds: 0 }
    }
  }

  get(track: Track, geometry: TrackGeometry, car: CarId, lighting: LightingMode, ghost: boolean, retainCanvas = false, lowQuality = false): HTMLElement {
    this.used = true
    const current = this.current
    if (current && current.track === track && current.geometry === geometry &&
        current.car === car && current.lighting === lighting && current.ghost === ghost && current.lowQuality === lowQuality) {
      return current.view.element
    }
    if (retainCanvas && current && current.track === track && current.geometry === geometry) {
      current.view.setPresentation(car, lighting, ghost, lowQuality)
      this.current = { ...current, car, lighting, ghost, lowQuality }
      return current.view.element
    }
    this.release()
    const view = createRaceFlyover(track, geometry, car, lighting, ghost, this.playback, lowQuality)
    this.current = { track, geometry, car, lighting, ghost, lowQuality, view }
    return view.element
  }

  end(): void {
    if (!this.used) this.release()
  }

  destroy(): void {
    this.release()
    this.key = undefined
    this.playback = { elapsedSeconds: 0 }
    this.used = false
  }

  private release(): void {
    this.current?.view.destroy()
    this.current = undefined
  }
}
