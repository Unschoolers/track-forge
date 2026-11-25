import Phaser from 'phaser'
import { ROAD_GEOMETRY } from '@/domain/config'
import { roadColorsForEnvironment } from '@/presentation/environments/roadMaterials'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { RoadPath } from '@/domain/track/pathBuilder'
import { renderCrossingUnderlay } from '@/phaser/rendering/crossingRenderer'
import { roadGateGeometry, roadGateSpan, type TrackGeometry } from '@/domain/track/trackGeometry'
import {
  boundsVisible,
  renderRaceRoadRibbon,
  renderRoadRibbon,
  type UpdateRoadRibbonVisibility,
} from '@/phaser/rendering/roadRibbonRenderer'
import { groundViewportBounds, type WorldBounds } from '@/presentation/environments/groundTexture'
import type { Vector2 } from '@/domain/model'
import { WORLD_RENDER_DEPTH } from '@/phaser/rendering/renderLayers'
import { createMeadowBitmapRenderer, ROAD_MARKINGS_DEPTH, type MeadowBitmapRenderer } from '@/phaser/rendering/meadowBitmapRenderer'
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

function color(value: string): number {
  return Phaser.Display.Color.HexStringToColor(value).color
}

export function renderRecoveryCheckpoints(
  graphics: Phaser.GameObjects.Graphics,
  path: RoadPath,
  checkpoints: readonly number[],
  editorZoom?: number,
): void {
  for (const index of checkpoints) {
    const gate = roadGateGeometry(path, index)
    if (!gate) continue
    const { center: point, tangent } = gate
    const span = roadGateSpan(path, index, ROAD_GEOMETRY.checkpointHalfWidth)
    const left = { x: point.x - tangent.y * span.min, y: point.y + tangent.x * span.min }
    const right = { x: point.x - tangent.y * span.max, y: point.y + tangent.x * span.max }
    // Author-owned checkpoints use a bright transverse stripe with visible endpoints.
    // No implicit race gates are painted anywhere.
    graphics.lineStyle(editorZoom ? 6 / editorZoom : 8, 0x66d9ff, 1)
    graphics.beginPath()
    graphics.moveTo(left.x, left.y)
    graphics.lineTo(right.x, right.y)
    graphics.strokePath()
    if (!editorZoom) {
      graphics.fillStyle(0xffffff, 1)
      graphics.fillCircle(left.x, left.y, 5)
      graphics.fillCircle(right.x, right.y, 5)
    }
    if (editorZoom) {
      const scale = 1 / Math.max(0.01, editorZoom)
      graphics.fillStyle(0x112c3d, 1)
      graphics.fillCircle(point.x, point.y, 8 * scale)
      graphics.lineStyle(2 * scale, 0x66d9ff, 1)
      graphics.strokeCircle(point.x, point.y, 8 * scale)
      graphics.fillStyle(0xf4f7fb, 1)
      graphics.fillCircle(point.x, point.y, 3.5 * scale)
    }
  }
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
}

export type RaceTrackVisibility = UpdateRoadRibbonVisibility & { readonly bitmap?: MeadowBitmapRenderer }

export function renderRaceTrackGeometryBase(
  scene: Phaser.Scene,
  geometry: TrackGeometry,
  night: boolean,
  environmentId: TrackEnvironmentId = 'grass',
): RaceTrackVisibility | undefined {
  const bitmap = createMeadowBitmapRenderer(scene, geometry, night, environmentId)
  const withBitmap = (update: UpdateRoadRibbonVisibility): RaceTrackVisibility =>
    bitmap ? Object.assign(update, { bitmap }) : update
  const markingsDepth = bitmap ? ROAD_MARKINGS_DEPTH : WORLD_RENDER_DEPTH.road
  const updateVisibility = renderRaceRoadRibbon(scene, geometry.path, geometry.ribbon, night, environmentId)
  if (!updateVisibility) {
    const graphics = scene.add.graphics().setDepth(WORLD_RENDER_DEPTH.road)
    renderRoadRibbon(graphics, geometry.path, geometry.ribbon, night, environmentId)
    if (!bitmap) {
      renderTrackGeometryMarkings(graphics, geometry, night, environmentId)
      return undefined
    }
    renderTrackGeometryMarkings(scene.add.graphics().setDepth(markingsDepth), geometry, night, environmentId)
    return withBitmap((view, paddedViewport) => bitmap.render(view, paddedViewport))
  }

  // Keep the original paint order (all curbs, then stripes, then markers),
  // while allowing Phaser to skip off-screen marking commands each frame.
  const batches: { graphics: Phaser.GameObjects.Graphics; bounds: WorldBounds }[] = []
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
    batches.push({ graphics, bounds: {
      left: left - 8, top: top - 8, right: right + 8, bottom: bottom + 8,
    } })
  }
  const batchSize = (count: number) => Math.max(128, Math.ceil(count / 64))
  const curbs = buildCurbSegments(geometry.path)
  const curbBatchSize = batchSize(curbs.length)
  for (let i = 0; i < curbs.length; i += curbBatchSize) {
    const batch = curbs.slice(i, i + curbBatchSize)
    addBatch(batch, curb => [curb.start, curb.end], graphics => renderCurbSegments(graphics, batch, night, environmentId))
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
  return withBitmap((view, paddedViewport) => {
    updateVisibility(view, paddedViewport)
    bitmap?.render(view, paddedViewport)
    const viewport = paddedViewport ?? groundViewportBounds(view)
    for (const { graphics, bounds } of batches) {
      const visible = boundsVisible(bounds, viewport)
      if (graphics.visible !== visible) graphics.setVisible(visible)
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
