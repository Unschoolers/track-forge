import Phaser from 'phaser'
import { SURFACE_SPECS } from '@/domain/config'
import type { buildRoadPath } from '@/domain/track/pathBuilder'
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
