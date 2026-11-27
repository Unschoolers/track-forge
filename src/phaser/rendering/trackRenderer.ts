import Phaser from 'phaser'
import { roadColorsForEnvironment } from '@/presentation/environments/roadMaterials'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { RoadPath } from '@/domain/track/pathBuilder'
import { renderCrossingUnderlay } from '@/phaser/rendering/crossingRenderer'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import {
  boundsVisible,
  renderRaceRoadRibbon,
  renderRoadRibbon,
  type UpdateRoadRibbonVisibility,
} from '@/phaser/rendering/roadRibbonRenderer'
import { groundViewportBounds, type WorldBounds } from '@/presentation/environments/groundTexture'
import type { Vector2 } from '@/domain/model'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { ROAD_MARKINGS_DEPTH, type MeadowBitmapRenderer } from '@/phaser/rendering/meadowBitmapRenderer'
import { createRaceBitmapAtlas } from '@/phaser/rendering/raceBitmapAtlas'
import {
  buildCurbSegments,
  renderCurbSegments,
  renderCurbs,
  renderStartGridPreview,
  renderStartLine,
} from '@/phaser/rendering/curbRenderer'
import {
  renderBridgeDeck,
  renderBridgeSideWalls,
  renderBridgeUnderlay,
} from '@/phaser/rendering/bridgeRenderer'
import {
  buildLampPosts,
  renderLampPosts,
} from '@/phaser/rendering/lampPostRenderer'
import { buildRoadTransitionCues, paintRoadTransitionCue, renderRoadTransitions } from '@/phaser/rendering/trackCues'
export { renderRecoveryCheckpoints } from '@/phaser/rendering/trackCues'

let nextToyCurbTexture = 0

function color(value: string): number {
  return Phaser.Display.Color.HexStringToColor(value).color
}

export function renderTrackGeometry(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
  showGridPreview = false,
  environmentId: TrackEnvironmentId = 'grass',
): void {
  renderTrackGeometryBase(graphics, geometry, night, environmentId)
  renderTrackGeometryStructureUnderlay(graphics, geometry, night, environmentId)
  if (showGridPreview) {
    renderTrackStartGridPreview(graphics, geometry)
  }
  renderBridgeDeck(graphics, geometry, night, 'terrain', graphics, environmentId)
  renderBridgeSideWalls(graphics, geometry, night, 'terrain', environmentId)
  renderLampPosts(graphics, buildLampPosts(geometry), night)
}

export function renderTrackStartGridPreview(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
): void {
  if (geometry.finish) return
  renderStartGridPreview(graphics, geometry.path, {
    ratio: geometry.start.ratio,
    reversed: geometry.start.reversed,
  })
}

export function renderTrackGeometryBase(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
  environmentId: TrackEnvironmentId = 'grass',
  markings: Phaser.GameObjects.Graphics = graphics,
): void {
  renderRoadRibbon(graphics, geometry.path, geometry.ribbon, night, environmentId)
  renderTrackGeometryMarkings(markings, geometry, night, environmentId)
  for (const cue of buildRoadTransitionCues(geometry.path, night)) {
    if (cue.kind === 'jump-lip') paintRoadTransitionCue(markings, cue)
  }
}

export type RaceTrackVisibility = UpdateRoadRibbonVisibility & { readonly bitmap?: MeadowBitmapRenderer }

export function renderRaceTrackGeometryBase(
  scene: Phaser.Scene,
  geometry: TrackGeometry,
  night: boolean,
  environmentId: TrackEnvironmentId = 'grass',
): RaceTrackVisibility | undefined {
  const bitmap = createRaceBitmapAtlas(scene, geometry, night, environmentId)
  const withBitmap = (update: UpdateRoadRibbonVisibility): RaceTrackVisibility =>
    bitmap ? Object.assign(update, { bitmap }) : update
  const markingsDepth = bitmap ? ROAD_MARKINGS_DEPTH : WORLD_RENDER_DEPTH.road
  // Complete atlas tiles include shoulders, road base and textured fill.
  // Only the untextured fallback needs the original ribbon graphics.
  const updateVisibility = bitmap ? undefined : renderRaceRoadRibbon(scene, geometry.path, geometry.ribbon, night, environmentId)
  if (!bitmap && !updateVisibility) {
    const graphics = scene.add.graphics().setDepth(WORLD_RENDER_DEPTH.road)
    renderRoadRibbon(graphics, geometry.path, geometry.ribbon, night, environmentId)
    renderTrackGeometryMarkings(graphics, geometry, night, environmentId)
    renderRoadTransitions(graphics, geometry.path, night)
    return undefined
  }

  // Keep the original paint order (all curbs, then stripes, then markers),
  // while allowing Phaser to skip off-screen marking commands each frame.
  const batches: { drawable: { visible: boolean; setVisible(visible: boolean): unknown }; bounds: WorldBounds }[] = []
  const bakeToyCurbs = bitmap !== undefined && environmentId === 'kids-room'
  const staticCurbTextures: string[] = []
  let staticCurbTexturePixels = 0
  if (bakeToyCurbs) {
    scene.events.once('shutdown', () => {
      for (const texture of staticCurbTextures) scene.textures.remove(texture)
    })
  }
  const addBatch = <T>(
    items: readonly T[],
    endpoints: (item: T) => readonly [Vector2, Vector2],
    paint: (graphics: Phaser.GameObjects.Graphics) => void,
  ) => {
    const graphics = scene.add.graphics().setDepth(markingsDepth)
    paint(graphics)
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    for (const item of items) {
      for (const point of endpoints(item)) {
        left = Math.min(left, point.x)
        top = Math.min(top, point.y)
        right = Math.max(right, point.x)
        bottom = Math.max(bottom, point.y)
      }
    }
    batches.push({ drawable: graphics, bounds: {
      left: left - 8, top: top - 8, right: right + 8, bottom: bottom + 8,
    } })
  }
  const batchSize = (count: number) => Math.max(128, Math.ceil(count / 64))
  const curbs = buildCurbSegments(geometry.path)
  const renderCurbBatch = (batch: typeof curbs) => {
    addBatch(batch, curb => [curb.start, curb.end], graphics => renderCurbSegments(graphics, batch, night, environmentId))
  }
  const curbBatchSize = bakeToyCurbs ? 16 : batchSize(curbs.length)
  for (let i = 0; i < curbs.length; i += curbBatchSize) {
    const batch = curbs.slice(i, i + curbBatchSize)
    if (bakeToyCurbs) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
      for (const curb of batch) {
        left = Math.min(left, curb.start.x, curb.end.x)
        top = Math.min(top, curb.start.y, curb.end.y)
        right = Math.max(right, curb.start.x, curb.end.x)
        bottom = Math.max(bottom, curb.start.y, curb.end.y)
      }
      const bounds = { left: left - 8, top: top - 8, right: right + 8, bottom: bottom + 8 }
      const width = Math.ceil(bounds.right - bounds.left)
      const height = Math.ceil(bounds.bottom - bounds.top)
      const pixels = width * height
      if (width > 0 && height > 0 && width <= 2048 && height <= 2048 &&
        staticCurbTexturePixels + pixels <= 8 * 1024 * 1024) {
        const graphics = scene.add.graphics()
        const texture = `race-toy-curbs-${++nextToyCurbTexture}`
        try {
          graphics.translateCanvas(-bounds.left, -bounds.top)
          renderCurbSegments(graphics, batch, night, environmentId)
          graphics.generateTexture(texture, width, height)
        } finally {
          graphics.destroy()
        }
        if (!scene.textures.exists(texture)) throw new Error('Could not create static toy curb texture')
        staticCurbTextures.push(texture)
        staticCurbTexturePixels += pixels
        const image = scene.add.image(bounds.left, bounds.top, texture).setOrigin(0).setDepth(markingsDepth)
        batches.push({ drawable: image, bounds })
      } else {
        renderCurbBatch(batch)
      }
    } else {
      renderCurbBatch(batch)
    }
  }
  const { path } = geometry
  const count = path.closed ? path.points.length : path.points.length - 1
  const stripes = []
  for (let index = 0; index < count; index += 3) {
    const previous = path.points[index]
    const current = path.points[(index + 1) % path.points.length]
    if (previous && current) stripes.push({ previous, current })
  }
  const stripeBatchSize = batchSize(stripes.length)
  for (let i = 0; i < stripes.length; i += stripeBatchSize) {
    const batch = stripes.slice(i, i + stripeBatchSize)
    addBatch(batch, stripe => [stripe.previous, stripe.current], graphics => {
      for (const { previous, current } of batch) renderStripe(graphics, previous, current, night, environmentId)
    })
  }
  const graphics = scene.add.graphics().setDepth(markingsDepth)
  renderTrackMarkers(graphics, geometry, night)
  const transitionCues = buildRoadTransitionCues(geometry.path, night)
  const transitionBatchSize = batchSize(transitionCues.length)
  const cueBoundsPoints = (cue: typeof transitionCues[number]): readonly [Vector2, Vector2] => [
    { x: cue.center.x - 30, y: cue.center.y - 30 },
    { x: cue.center.x + 30, y: cue.center.y + 30 },
  ]
  for (let index = 0; index < transitionCues.length; index += transitionBatchSize) {
    const batch = transitionCues.slice(index, index + transitionBatchSize)
    addBatch(batch, cueBoundsPoints, target => {
      for (const cue of batch) paintRoadTransitionCue(target, cue)
    })
  }
  return withBitmap((view, paddedViewport) => {
    updateVisibility?.(view, paddedViewport)
    bitmap?.render(view, paddedViewport)
    const viewport = paddedViewport ?? groundViewportBounds(view)
    for (const { drawable, bounds } of batches) {
      const visible = boundsVisible(bounds, viewport)
      if (drawable.visible !== visible) drawable.setVisible(visible)
    }
  })
}

export function renderTrackGeometryStructureUnderlay(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
  environmentId: TrackEnvironmentId = 'grass',
): void {
  renderBridgeUnderlay(graphics, geometry, night, 'terrain', environmentId)
}

function renderTrackGeometryMarkings(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
  environmentId: TrackEnvironmentId = 'grass',
): void {
  const { path } = geometry
  const segmentCount = path.closed
    ? path.points.length
    : path.points.length - 1
  renderCurbs(graphics, path, night, environmentId)

  for (let index = 0; index < segmentCount; index += 3) {
    const previous = path.points[index]
    const current = path.points[(index + 1) % path.points.length]
    if (!previous || !current) continue
    renderStripe(graphics, previous, current, night, environmentId)
  }
  renderTrackMarkers(graphics, geometry, night)
}

function renderStripe(graphics: Phaser.GameObjects.Graphics, previous: RoadPath['points'][number], current: RoadPath['points'][number], night: boolean, environmentId: TrackEnvironmentId): void {
  const spec = roadColorsForEnvironment(previous.surface, environmentId)
  graphics.lineStyle(previous.surface === 'street' ? 2.2 : 1.5, color(night ? spec.nightStripe : spec.stripe), previous.surface === 'street' ? 0.78 : 0.45)
  graphics.beginPath()
  graphics.moveTo(previous.x, previous.y)
  graphics.lineTo(current.x, current.y)
  graphics.strokePath()
}

function renderTrackMarkers(graphics: Phaser.GameObjects.Graphics, geometry: TrackGeometry, night: boolean): void {
  const { path } = geometry
  renderStartLine(graphics, path, night, geometry.start.ratio)
  renderCrossingUnderlay(graphics, path, night)
  if (geometry.finish) {
    for (const [marker, markerColor] of [[geometry.start, 0x38df9b], [geometry.finish, 0xffd45c]] as const) {
      const normal = { x: -marker.tangent.y, y: marker.tangent.x }
      const halfWidth = 30
      graphics.lineStyle(6, markerColor, 1)
      graphics.beginPath()
      graphics.moveTo(marker.position.x - normal.x * halfWidth, marker.position.y - normal.y * halfWidth)
      graphics.lineTo(marker.position.x + normal.x * halfWidth, marker.position.y + normal.y * halfWidth)
      graphics.strokePath()
    }
  }
}
