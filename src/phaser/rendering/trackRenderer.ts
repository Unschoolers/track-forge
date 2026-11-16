import Phaser from 'phaser'
import { SURFACE_SPECS } from '@/domain/config'
import type { buildRoadPath, RoadPath } from '@/domain/track/pathBuilder'
import { renderCrossingUnderlay } from '@/phaser/rendering/crossingRenderer'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { renderRoadRibbon } from '@/phaser/rendering/roadRibbonRenderer'
import {
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
): void {
  const count = path.points.length
  for (const index of checkpoints) {
    const point = path.points[index]
    const after = path.points[path.closed ? (index + 1) % count : index + 1]
    if (!point || !after) continue
    const length = Math.hypot(after.x - point.x, after.y - point.y)
    if (length < 0.001) continue
    const x = -(after.y - point.y) / length * 34
    const y = (after.x - point.x) / length * 34
    graphics.lineStyle(7, 0x66d9ff, 1)
    graphics.beginPath()
    graphics.moveTo(point.x - x, point.y - y)
    graphics.lineTo(point.x + x, point.y + y)
    graphics.strokePath()
  }
}

export function renderTrackGeometry(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
  showGridPreview = false,
): void {
  renderTrackGeometryBase(graphics, geometry, night)
  renderTrackGeometryStructureUnderlay(graphics, geometry, night)
  if (showGridPreview) {
    renderTrackStartGridPreview(graphics, geometry)
  }
  renderBridgeDeck(graphics, geometry, night)
  renderBridgeSideWalls(graphics, geometry, night)
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
): void {
  renderPathBase(
    graphics,
    geometry.path,
    geometry.ribbon,
    night,
    geometry.start.ratio,
  )
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

export function renderTrackGeometryStructureUnderlay(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
): void {
  renderBridgeUnderlay(graphics, geometry, night)
}

export function renderTrackGeometryBridgeOverlay(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
  walls = false,
): void {
  if (walls) {
    renderBridgeSideWalls(graphics, geometry, night)
  } else {
    renderBridgeDeck(graphics, geometry, night)
  }
}

function renderPathBase(
  graphics: Phaser.GameObjects.Graphics,
  path: ReturnType<typeof buildRoadPath>,
  ribbon: TrackGeometry['ribbon'],
  night: boolean,
  startRatio = 0,
): void {
  const segmentCount = path.closed
    ? path.points.length
    : path.points.length - 1
  renderRoadRibbon(graphics, path, ribbon, night)
  renderCurbs(graphics, path, night)

  for (let index = 0; index < segmentCount; index += 3) {
    const previous = path.points[index]
    const current = path.points[(index + 1) % path.points.length]
    if (!previous || !current) continue
    const spec = SURFACE_SPECS[previous.surface]
    graphics.lineStyle(
      previous.surface === 'street' ? 2.2 : 1.5,
      color(night ? spec.nightStripe : spec.stripe),
      previous.surface === 'street' ? 0.78 : 0.45,
    )
    graphics.beginPath()
    graphics.moveTo(previous.x, previous.y)
    graphics.lineTo(current.x, current.y)
    graphics.strokePath()
  }
  renderStartLine(graphics, path, night, startRatio)
  renderCrossingUnderlay(graphics, path, night)
}
