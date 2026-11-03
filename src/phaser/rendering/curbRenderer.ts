import type Phaser from 'phaser'
import { ROAD_GEOMETRY } from '@/domain/config'
import type { TrackStart, Vector2 } from '@/domain/model'
import type { RoadPath } from '@/domain/track/pathBuilder'
import { samplePathBehindStart } from '@/domain/race/raceFactory'

export interface CurbSegment {
  readonly start: Vector2
  readonly end: Vector2
  readonly width: number
  readonly color: 'red' | 'white'
}

export interface StartLineTile {
  readonly points: readonly [Vector2, Vector2, Vector2, Vector2]
  readonly color: 'light' | 'dark'
}

const CURB_COLORS = {
  day: { red: 0xd94141, white: 0xf6f2e8 },
  night: { red: 0x9f3338, white: 0xbfc4c7 },
} as const

export function buildCurbSegments(path: RoadPath): readonly CurbSegment[] {
  const points = path.points
  if (points.length < 5) return []
  const segments: CurbSegment[] = []
  const from = path.closed ? 0 : 2
  const to = path.closed ? points.length : points.length - 2

  for (let index = from; index < to; index += 2) {
    const previous = points[(index - 2 + points.length) % points.length]
    const current = points[index]
    const next = points[(index + 2) % points.length]
    if (!previous || !current || !next || current.surface !== 'street') {
      continue
    }
    const incoming = Math.atan2(
      current.y - previous.y,
      current.x - previous.x,
    )
    const outgoing = Math.atan2(next.y - current.y, next.x - current.x)
    const turn = Math.atan2(
      Math.sin(outgoing - incoming),
      Math.cos(outgoing - incoming),
    )
    if (Math.abs(turn) < 0.015) continue

    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const length = Math.hypot(dx, dy)
    if (length < 0.001) continue
    // In screen coordinates the left-hand normal has the same signed cross
    // product as the turn. Match those signs to decorate the apex, not the
    // outside edge of the bend.
    const side = turn > 0 ? 1 : -1
    const normal = { x: (-dy / length) * side, y: (dx / length) * side }
    const offset = (ROAD_GEOMETRY.curbInner + ROAD_GEOMETRY.curbOuter) / 2
    const halfLength = Math.min(9, length / 4)
    const tangent = { x: dx / length, y: dy / length }
    const center = {
      x: current.x + normal.x * offset,
      y: current.y + normal.y * offset,
    }
    segments.push({
      start: {
        x: center.x - tangent.x * halfLength,
        y: center.y - tangent.y * halfLength,
      },
      end: {
        x: center.x + tangent.x * halfLength,
        y: center.y + tangent.y * halfLength,
      },
      width: ROAD_GEOMETRY.curbOuter - ROAD_GEOMETRY.curbInner,
      color: segments.length % 2 === 0 ? 'red' : 'white',
    })
  }
  return segments
}

export function buildStartLineTiles(
  path: RoadPath,
  startRatio = 0,
): readonly StartLineTile[] {
  const startDistance =
    path.totalLength * Math.max(0, Math.min(0.999_999, startRatio))
  const index = Math.max(
    0,
    path.points.findIndex((point) => point.distance >= startDistance),
  )
  const start = path.points[index]
  const next = path.points[(index + 1) % path.points.length]
  if (!path.closed || !start || !next) return []
  const dx = next.x - start.x
  const dy = next.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 0.001) return []
  const tangent = { x: dx / length, y: dy / length }
  const normal = { x: -tangent.y, y: tangent.x }
  const tileWidth = ROAD_GEOMETRY.surfaceWidth / 8
  const halfDepth = 5

  return Array.from({ length: 8 }, (_, index) => {
    const near = -ROAD_GEOMETRY.surfaceWidth / 2 + index * tileWidth
    const far = near + tileWidth
    const point = (across: number, along: number): Vector2 => ({
      x: start.x + normal.x * across + tangent.x * along,
      y: start.y + normal.y * across + tangent.y * along,
    })
    return {
      points: [
        point(near, -halfDepth),
        point(far, -halfDepth),
        point(far, halfDepth),
        point(near, halfDepth),
      ],
      color: index % 2 === 0 ? 'light' : 'dark',
    }
  })
}

export function renderCurbs(
  graphics: Phaser.GameObjects.Graphics,
  path: RoadPath,
  night: boolean,
): void {
  const palette = night ? CURB_COLORS.night : CURB_COLORS.day
  for (const curb of buildCurbSegments(path)) {
    graphics.lineStyle(curb.width, palette[curb.color], 1)
    graphics.beginPath()
    graphics.moveTo(curb.start.x, curb.start.y)
    graphics.lineTo(curb.end.x, curb.end.y)
    graphics.strokePath()
  }
}

export function renderStartLine(
  graphics: Phaser.GameObjects.Graphics,
  path: RoadPath,
  night: boolean,
  startRatio = 0,
): void {
  for (const tile of buildStartLineTiles(path, startRatio)) {
    graphics.fillStyle(
      tile.color === 'light'
        ? night
          ? 0xd8dce0
          : 0xffffff
        : night
          ? 0x1a1e24
          : 0x20242a,
      1,
    )
    const [first, ...remaining] = tile.points
    graphics.beginPath()
    graphics.moveTo(first.x, first.y)
    for (const point of remaining) graphics.lineTo(point.x, point.y)
    graphics.closePath()
    graphics.fillPath()
  }
}

export function renderStartGridPreview(
  graphics: Phaser.GameObjects.Graphics,
  path: RoadPath,
  start: TrackStart,
): void {
  const startDistance = path.totalLength * start.ratio
  const startIndex = Math.max(
    0,
    path.points.findIndex((point) => point.distance >= startDistance),
  )
  graphics.fillStyle(0xffffff, 0.18)
  graphics.lineStyle(1.5, 0xffffff, 0.55)
  for (const grid of ROAD_GEOMETRY.startGrid) {
    const placement = samplePathBehindStart(
      path,
      grid.back,
      startIndex,
      start.reversed,
    )
    graphics.save()
    graphics.translateCanvas(
      placement.x + placement.normal.x * grid.lane,
      placement.y + placement.normal.y * grid.lane,
    )
    graphics.rotateCanvas(
      Math.atan2(placement.tangent.y, placement.tangent.x),
    )
    graphics.fillRoundedRect(-16, -8, 32, 16, 4)
    graphics.strokeRoundedRect(-16, -8, 32, 16, 4)
    graphics.restore()
  }
}
