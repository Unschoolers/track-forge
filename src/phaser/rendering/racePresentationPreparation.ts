import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { prepareRaceAtlas, type RaceAtlasTextureManager } from '@/phaser/rendering/raceBitmapAtlas'
import { RACE_CAMERA_TUNING } from '@/phaser/camera/raceCamera'
import { prepareBridgePresentation } from '@/phaser/rendering/bridgeRenderer'
import { ensureGroundTexture, type GroundTextureManager } from '@/phaser/rendering/environmentRenderer'
import { buildLampLights, prepareLampPosts } from '@/phaser/rendering/lampPostRenderer'
import { visibleGroundTilesForViewport } from '@/presentation/environments/groundTexture'

const SLICE_BUDGET_MS = 3

interface GroundPreparation {
  readonly textures: GroundTextureManager
  readonly width: number
  readonly height: number
  readonly lowQuality?: boolean
  readonly atlasTextures?: RaceAtlasTextureManager
}

function* prepareRacePresentation(
  geometry: TrackGeometry,
  environmentId: TrackEnvironmentId,
  night: boolean,
  ground: GroundPreparation | undefined,
): Generator<void, void, void> {
  if (ground) {
    const { textures, width, height } = ground
    // RaceScene starts with the camera at its default scroll and zoom.
    const tiles = visibleGroundTilesForViewport({
      centerX: width / 2,
      centerY: height / 2,
      width,
      height,
      zoom: 1,
      rotation: 0,
      minimumZoom: RACE_CAMERA_TUNING.minimumZoom,
    })
    const variants = new Set(tiles.map(({ variant }) => variant))
    for (const variant of variants) {
      ensureGroundTexture(textures, environmentId, variant, night, ground.lowQuality)
      yield
    }
  }
  yield* prepareBridgePresentation(geometry)
  const lamps = yield* prepareLampPosts(geometry)
  if (night) buildLampLights(lamps)
  if (ground?.atlasTextures) {
    for (const progress of prepareRaceAtlas(ground.atlasTextures, geometry, night, environmentId)) {
      void progress
      yield
    }
  }
}

// The timer runs after the browser has had a chance to paint the flyover.
function scheduleAfterFrame(task: () => void): () => void {
  let timer: number | undefined
  const frame = window.requestAnimationFrame(() => {
    timer = window.setTimeout(task, 0)
  })
  return () => {
    window.cancelAnimationFrame(frame)
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

export class RacePresentationPreparation {
  private work: Generator<void, void, void> | undefined
  private cancelSlice: (() => void) | undefined
  private foreground = true

  constructor(
    private readonly schedule = scheduleAfterFrame,
    private readonly now = () => performance.now(),
    private readonly reportFailure: (error: unknown) => void =
      error => console.error('Race presentation prewarm failed; normal rendering will continue.', error),
  ) {}

  prepare(
    geometry: TrackGeometry,
    environmentId: TrackEnvironmentId,
    night: boolean,
    ground?: GroundPreparation,
  ): () => void {
    this.cancel()
    const work = prepareRacePresentation(geometry, environmentId, night, ground)
    this.work = work
    this.scheduleSlice()
    return () => {
      if (this.work === work) this.cancel()
    }
  }

  setForeground(foreground: boolean): void {
    this.foreground = foreground
    if (foreground) this.scheduleSlice()
    else this.unscheduleSlice()
  }

  cancel(): void {
    this.unscheduleSlice()
    this.work = undefined
  }

  private unscheduleSlice(): void {
    const cancel = this.cancelSlice
    this.cancelSlice = undefined
    cancel?.()
  }

  private scheduleSlice(): void {
    const work = this.work
    if (!this.foreground || !work || this.cancelSlice) return
    const cancel: () => void = this.schedule(() => {
      if (this.cancelSlice !== cancel) return
      this.cancelSlice = undefined
      const deadline = this.now() + SLICE_BUDGET_MS
      try {
        do {
          if (work.next().done) {
            this.work = undefined
            return
          }
        } while (this.now() < deadline)
      } catch (error) {
        // A race can still use regular synchronous rendering, but prewarm
        // failures must remain visible rather than disappearing silently.
        this.work = undefined
        this.reportFailure(error)
        return
      }
      this.scheduleSlice()
    })
    this.cancelSlice = cancel
  }
}
