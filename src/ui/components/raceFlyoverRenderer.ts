import { CAR_SPECS, ROAD_GEOMETRY, SURFACE_SPECS } from '@/domain/config'
import type { CarId, LightingMode, Track, Vector2 } from '@/domain/model'
import type { RoadPathPoint } from '@/domain/track/pathBuilder'
import type { TrackGeometry } from '@/domain/track/trackGeometry'

interface RoutePosition extends Vector2 {
  readonly angle: number
}

/** Prepare a bounded amount of scenery once; each frame only paints nearby pieces. */
export function createRaceFlyoverRenderer(
  geometry: TrackGeometry,
  track: Track,
  car: CarId,
  lighting: LightingMode,
  ghost: boolean,
): (ctx: CanvasRenderingContext2D, width: number, height: number, elapsedSeconds: number) => void {
  const path = geometry.path
  const points = path.points
  const reverse = geometry.start.reversed
  const direction = reverse ? -1 : 1
  const night = lighting === 'night'
  const stride = Math.max(1, Math.ceil(points.length / 1200))
  const sections: { a: RoadPathPoint; b: RoadPathPoint }[] = []
  for (let i = 0; i < points.length - 1; i += stride) {
    const a = points[i]
    const b = points[Math.min(i + stride, points.length - 1)]
    if (a && b) sections.push({ a, b })
  }
  if (path.closed && points.length > 1) {
    const a = points[points.length - 1]
    const b = points[0]
    if (a && b) sections.push({ a, b })
  }
  const treeStride = Math.max(1, Math.ceil(track.trees.length / 350))
  const trees = track.trees.filter((_, index) => index % treeStride === 0)

  function pointAt(distance: number): Vector2 {
    const first = points[0]
    if (!first) return { x: 0, y: 0 }
    const length = path.totalLength
    const target = length > 0
      ? path.closed ? ((distance % length) + length) % length : Math.max(0, Math.min(length, distance))
      : 0
    let low = 0
    let high = points.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if ((points[middle]?.distance ?? 0) < target) low = middle + 1
      else high = middle
    }
    const last = points[points.length - 1] ?? first
    const closing = path.closed && target > last.distance
    const next = closing ? first : points[low] ?? first
    const previous = closing ? last : points[Math.max(0, low - 1)] ?? next
    const endDistance = closing ? length : next.distance
    const span = endDistance - previous.distance
    const fraction = span > 0 ? (target - previous.distance) / span : 0
    return { x: previous.x + (next.x - previous.x) * fraction, y: previous.y + (next.y - previous.y) * fraction }
  }

  function position(distance: number): RoutePosition {
    const current = pointAt(distance)
    const before = pointAt(distance - 8)
    const after = pointAt(distance + 8)
    const angle = Math.atan2(after.y - before.y, after.x - before.x) + (reverse ? Math.PI : 0)
    return { ...current, angle }
  }

  // Merge adjacent authored terrain cells into short rows to preserve large shapes
  // without painting tens of thousands of individual tiles per animation frame.
  const terrain = [...track.terrain.cells].sort((a, b) => a.kind.localeCompare(b.kind) || a.row - b.row || a.column - b.column)
  const runs: { kind: 'hill' | 'water'; row: number; column: number; count: number }[] = []
  for (const cell of terrain) {
    const last = runs[runs.length - 1]
    if (last && last.kind === cell.kind && last.row === cell.row && last.column + last.count === cell.column) last.count++
    else runs.push({ kind: cell.kind, row: cell.row, column: cell.column, count: 1 })
  }
  const terrainStride = Math.max(1, Math.ceil(runs.length / 1800))
  const lampSpacing = Math.max(180, path.totalLength / 180)
  const lamps: Vector2[] = []
  if (night) {
    for (let at = 0; at < path.totalLength; at += lampSpacing) lamps.push(pointAt(at))
  }

  function drawCar(ctx: CanvasRenderingContext2D, position: RoutePosition, color: string, lane: number): void {
    ctx.save()
    ctx.translate(position.x - Math.sin(position.angle) * lane, position.y + Math.cos(position.angle) * lane)
    ctx.rotate(position.angle)
    if (night) {
      const beam = ctx.createLinearGradient(10, 0, 125, 0)
      beam.addColorStop(0, 'rgba(255, 235, 160, .5)')
      beam.addColorStop(1, 'rgba(255, 235, 160, 0)')
      ctx.fillStyle = beam
      ctx.beginPath()
      ctx.moveTo(8, -7)
      ctx.lineTo(125, -38)
      ctx.lineTo(125, 38)
      ctx.lineTo(8, 7)
      ctx.closePath()
      ctx.fill()
    }
    ctx.fillStyle = 'rgba(0, 0, 0, .34)'
    ctx.fillRect(-14, -7, 31, 18)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(-16, -9, 32, 18, 5)
    ctx.fill()
    ctx.fillStyle = night ? '#a9d0d6' : '#d7eff3'
    ctx.fillRect(3, -6, 5, 12)
    ctx.fillStyle = '#26313a'
    ctx.fillRect(-9, -6, 5, 12)
    ctx.fillStyle = night ? '#fff3b0' : '#f6f2d6'
    ctx.fillRect(13, -7, 3, 4)
    ctx.fillRect(13, 3, 3, 4)
    ctx.restore()
  }

  return (ctx, width, height, elapsedSeconds) => {
    if (width <= 0 || height <= 0) return
    const distance = geometry.start.distance + direction * (45 + Math.max(0, elapsedSeconds) * 70)
    const player = position(distance)
    const ahead = position(distance + direction * 75)
    const cameraAngle = Math.atan2(ahead.y - player.y, ahead.x - player.x)
    const heading = Number.isFinite(cameraAngle) ? cameraAngle : player.angle
    const drift = Math.sin(elapsedSeconds * 0.45)
    const altitude = Math.cos(elapsedSeconds * 0.36)
    const scale = Math.max(0.23, Math.min(0.44, height / 440)) * (1 + altitude * 0.035)
    const radius = Math.hypot(width, height) / scale + 200
    const visible = (x: number, y: number) => Math.abs(x - player.x) < radius && Math.abs(y - player.y) < radius

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = night ? '#182d2b' : '#568453'
    ctx.fillRect(0, 0, width, height)
    ctx.save()
    ctx.translate(width * (0.5 + drift * 0.03), height * (0.66 + altitude * 0.02))
    // The camera follows the road with a slight drifting yaw, like a hovering drone.
    ctx.rotate(-heading - Math.PI / 2 + drift * 0.05)
    ctx.scale(scale, scale)
    ctx.translate(-player.x, -player.y)

    const cellSize = track.terrain.cellSize
    for (let i = 0; i < runs.length; i += terrainStride) {
      const run = runs[i]
      if (!run) continue
      const x = run.column * cellSize
      const y = run.row * cellSize
      const runWidth = run.count * cellSize
      if (x > player.x + radius || x + runWidth < player.x - radius || Math.abs(y - player.y) > radius + cellSize) continue
      ctx.fillStyle = run.kind === 'water' ? (night ? '#214b5c' : '#4d9cb1') : (night ? '#34533f' : '#80a66a')
      ctx.fillRect(x, y, runWidth, cellSize)
      if (run.kind === 'hill') {
        ctx.fillStyle = night ? 'rgba(181, 204, 155, .10)' : 'rgba(226, 239, 186, .18)'
        ctx.fillRect(x, y, runWidth, Math.max(2, cellSize * .12))
      }
    }
    for (const tree of trees) {
      if (!visible(tree.x, tree.y)) continue
      ctx.fillStyle = night ? 'rgba(0, 0, 0, .26)' : 'rgba(21, 54, 31, .24)'
      ctx.beginPath(); ctx.ellipse(tree.x + 12, tree.y + 12, 23, 13, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = night ? '#1b4738' : '#2c6b3c'
      ctx.beginPath(); ctx.arc(tree.x, tree.y, 18, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = night ? '#275642' : '#478c4c'
      ctx.beginPath(); ctx.arc(tree.x - 5, tree.y - 5, 10, 0, Math.PI * 2); ctx.fill()
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Elevated runs cast a narrow shadow and receive a brighter deck edge.
    for (const section of sections) {
      if (section.a.structure !== 'overpass' || (!visible(section.a.x, section.a.y) && !visible(section.b.x, section.b.y))) continue
      ctx.beginPath(); ctx.moveTo(section.a.x + 9, section.a.y + 12); ctx.lineTo(section.b.x + 9, section.b.y + 12)
      ctx.lineWidth = ROAD_GEOMETRY.edgeWidth + 14
      ctx.strokeStyle = 'rgba(0, 0, 0, .3)'
      ctx.stroke()
    }
    for (const edge of [true, false]) {
      for (const section of sections) {
        if (!visible(section.a.x, section.a.y) && !visible(section.b.x, section.b.y)) continue
        const spec = SURFACE_SPECS[section.a.surface]
        ctx.beginPath(); ctx.moveTo(section.a.x, section.a.y); ctx.lineTo(section.b.x, section.b.y)
        ctx.lineWidth = edge ? ROAD_GEOMETRY.edgeWidth : ROAD_GEOMETRY.surfaceWidth
        ctx.strokeStyle = edge && section.a.structure === 'overpass' ? (night ? '#aab4b2' : '#f3e9d3') : edge ? (night ? spec.nightEdge : spec.edge) : (night ? spec.nightRoad : spec.road)
        ctx.stroke()
      }
    }
    // Road markings and warm pools make the direction and night scene readable at small sizes.
    ctx.setLineDash([20, 26])
    ctx.lineWidth = 2
    for (const section of sections) {
      if (!visible(section.a.x, section.a.y) && !visible(section.b.x, section.b.y)) continue
      const spec = SURFACE_SPECS[section.a.surface]
      ctx.strokeStyle = night ? spec.nightStripe : spec.stripe
      ctx.lineDashOffset = -section.a.distance
      ctx.beginPath(); ctx.moveTo(section.a.x, section.a.y); ctx.lineTo(section.b.x, section.b.y); ctx.stroke()
    }
    ctx.setLineDash([])
    if (night && path.totalLength > 0) {
      for (const lamp of lamps) {
        if (!visible(lamp.x, lamp.y)) continue
        const glow = ctx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, 95)
        glow.addColorStop(0, 'rgba(255, 200, 100, .17)')
        glow.addColorStop(1, 'rgba(255, 200, 100, 0)')
        ctx.fillStyle = glow
        ctx.beginPath(); ctx.arc(lamp.x, lamp.y, 95, 0, Math.PI * 2); ctx.fill()
      }
    }
    const start = geometry.start
    if (visible(start.position.x, start.position.y)) {
      ctx.save()
      ctx.translate(start.position.x, start.position.y)
      ctx.rotate(Math.atan2(start.tangent.y, start.tangent.x))
      ctx.fillStyle = '#f6f2e5'
      ctx.fillRect(-3, -ROAD_GEOMETRY.surfaceWidth / 2, 6, ROAD_GEOMETRY.surfaceWidth)
      ctx.restore()
    }
    if (!ghost) {
      drawCar(ctx, position(distance + direction * 100), CAR_SPECS[car === 'red' ? 'yellow' : 'red'].color, -14)
      drawCar(ctx, position(distance - direction * 95), CAR_SPECS[car === 'green' ? 'blue' : 'green'].color, 14)
    }
    drawCar(ctx, player, CAR_SPECS[car].color, 0)
    ctx.restore()
  }
}
