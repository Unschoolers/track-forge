import type { CarId, LightingMode, Track } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { createRaceFlyoverRenderer } from '@/ui/components/raceFlyoverRenderer'
import { button, element } from '@/ui/dom'

const FRAME_INTERVAL_MS = 32

export interface RaceFlyoverPlayback {
  elapsedSeconds: number
  playing?: boolean
}

export function createRaceFlyover(
  track: Track,
  geometry: TrackGeometry,
  car: CarId,
  lighting: LightingMode,
  ghost: boolean,
  playback: RaceFlyoverPlayback,
) {
  const panel = element('div', 'race-flyover-panel')
  const canvas = element('canvas', 'race-flyover')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', `${lighting === 'night' ? 'Nighttime' : 'Daytime'} flyover of ${track.name}`)
  canvas.dataset.car = car
  canvas.dataset.lighting = lighting
  const paint = createRaceFlyoverRenderer(geometry, track, car, lighting, ghost)
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let playing = playback.playing ?? !motion?.matches
  let visible = true
  let frame: number | undefined
  let lastFrame: number | undefined
  const toggle = button('', 'toggle-race-flyover', () => {
    playback.playing = !playing
    setPlaying(playback.playing)
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
    if (lastFrame === undefined || dt >= FRAME_INTERVAL_MS || !playing) {
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
      const pixelWidth = Math.round(width * pixelRatio)
      const pixelHeight = Math.round(height * pixelRatio)
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      if (playing) playback.elapsedSeconds += Math.min(dt, 100) / 1000
      paint(context, width, height, playback.elapsedSeconds)
      lastFrame = now
    }
    if (playing) schedule()
  }

  function refresh(): void {
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    frame = undefined
    lastFrame = undefined
    schedule()
  }

  function setPlaying(value: boolean): void {
    playing = value
    const label = playing ? 'Pause flyover' : 'Play flyover'
    toggle.setAttribute('aria-label', label)
    toggle.title = label
    toggle.classList.toggle('playing', playing)
    refresh()
  }

  const onMotionChange = () => {
    delete playback.playing
    setPlaying(!motion?.matches)
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
  setPlaying(playing)
  return {
    element: panel,
    destroy(): void {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      resize?.disconnect()
      intersection?.disconnect()
      motion?.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', refresh)
    },
  }
}
