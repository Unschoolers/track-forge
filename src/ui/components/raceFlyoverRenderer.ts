import { ROAD_GEOMETRY } from '@/domain/config'
import { roadColorsForEnvironment } from '@/presentation/environments/roadMaterials'
import { environmentRoadStrokes } from '@/presentation/environments/environmentRoadStrokes'
import { shorelineBands } from '@/presentation/environments/shorelineMaterials'
import { createMeadowBitmapLayers, drawBitmapTiles } from '@/presentation/environments/meadowBitmapTiles'
import { getMeadowBitmapArt } from '@/presentation/environments/meadowBitmapArt'
import { getNightHeadlightBeam, NIGHT_HEADLIGHT } from '@/presentation/nightLighting'
import { drawVehicleArtworkOnCanvas, VEHICLE_VISUAL_SCALE } from '@/presentation/vehicleArtwork'
import type { CarId, LightingMode, Track, Vector2 } from '@/domain/model'
import type { RoadPathPoint } from '@/domain/track/pathBuilder'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { getTrackEnvironment } from '@/presentation/environments'
import { normalizeTrackEnvironmentId, type TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { buildSceneryPresentation } from '@/presentation/environments/sceneryPresentation'
import { GRASS_TILE_PADDING } from '@/presentation/environments/grassTileImage'
import { getEnvironmentTileImage } from '@/presentation/environments/environmentTileImage'
import {
  GROUND_TILE_SIZE,
  visibleGroundTilesForViewport,
  type GroundViewport,
} from '@/presentation/environments/groundTexture'

interface RoutePosition extends Vector2 {
  readonly angle: number
}

function drawGroundTexture(ctx: CanvasRenderingContext2D, viewport: GroundViewport, night: boolean, environmentId: TrackEnvironmentId): void {
  for (const tile of visibleGroundTilesForViewport(viewport)) {
    ctx.drawImage(
      getEnvironmentTileImage(environmentId, tile.variant, night),
      tile.x * GROUND_TILE_SIZE - GRASS_TILE_PADDING,
      tile.y * GROUND_TILE_SIZE - GRASS_TILE_PADDING,
    )
  }
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
  const environmentId = normalizeTrackEnvironmentId(track.environmentId)
  const palette = getTrackEnvironment(environmentId)[lighting]
  const bitmap = createMeadowBitmapLayers(geometry, night, environmentId)
  const bitmapArt = environmentId === 'grass' ? getMeadowBitmapArt(night) : undefined
  const props = track.scenery ?? []
  let sceneryWindow = ''
  let scenery = buildSceneryPresentation(environmentId, [], lighting, { left: 0, top: 0, right: 0, bottom: 0 })
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
    if (a && b) sections.push({ a, b: { ...b, distance: path.totalLength } })
  }
  // Flyover frames must only paint. Prepare distance-anchored details once
  // rather than allocating strokes for every visible section on every frame.
  const materialSections = sections.map((section) => ({
    ...section,
    strokes: environmentRoadStrokes(environmentId, section.a.surface, section.a, section.b, night, path.closed ? path.totalLength : undefined),
  }))
  // Cache actual water contour bounds once. No new geometry is compiled per frame.
  const waterRings = palette.shorelineBands ? path.terrainSurface.contours
    .filter(contour => contour.kind === 'water' && contour.points.length >= 3)
    .map(({ points }) => {
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
      for (const point of points) {
        left = Math.min(left, point.x); right = Math.max(right, point.x)
        top = Math.min(top, point.y); bottom = Math.max(bottom, point.y)
      }
      return { points, left, right, top, bottom }
    }) : []
  const bankBands = shorelineBands(palette, night)
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

  function drawCar(ctx: CanvasRenderingContext2D, position: RoutePosition, carId: CarId, lane: number): void {
    ctx.save()
    ctx.translate(position.x - Math.sin(position.angle) * lane, position.y + Math.cos(position.angle) * lane)
    ctx.rotate(position.angle)
    ctx.scale(VEHICLE_VISUAL_SCALE, VEHICLE_VISUAL_SCALE)
    if (night) {
      ctx.drawImage(
        getNightHeadlightBeam(),
        NIGHT_HEADLIGHT.carFrontX - NIGHT_HEADLIGHT.sourceX,
        -NIGHT_HEADLIGHT.height / 2,
      )
    }
    // The same body, roof, windows, wheels, bed and fixtures as the real race.
    if (!night) {
      ctx.fillStyle = 'rgba(0, 0, 0, .24)'
      ctx.beginPath()
      ctx.ellipse(2, 3, 24, 12, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    drawVehicleArtworkOnCanvas(ctx, carId)
    ctx.restore()
  }

  return (ctx, width, height, elapsedSeconds) => {
    if (width <= 0 || height <= 0) return
    const travel = 45 + Math.max(0, elapsedSeconds) * 70
    const routeLength = Math.abs((geometry.finish?.distance ?? geometry.start.distance) - geometry.start.distance)
    const distance = geometry.start.distance + direction * (!path.closed && routeLength > 0 ? travel % routeLength : travel)
    const player = position(distance)
    const ahead = position(distance + direction * 75)
    const cameraAngle = Math.atan2(ahead.y - player.y, ahead.x - player.x)
    const heading = Number.isFinite(cameraAngle) ? cameraAngle : player.angle
    const drift = Math.sin(elapsedSeconds * 0.45)
    const altitude = Math.cos(elapsedSeconds * 0.36)
    const baseScale = Math.max(0.23, Math.min(0.44, height / 440))
    const scale = baseScale * (1 + altitude * 0.035)
    const rotation = -heading - Math.PI / 2 + drift * 0.05
    const focusX = width * (0.5 + drift * 0.03)
    const focusY = height * (0.66 + altitude * 0.02)
    const radius = Math.hypot(width, height) / scale + 200
    const visible = (x: number, y: number) => Math.abs(x - player.x) < radius && Math.abs(y - player.y) < radius

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = palette.flyoverGround
    ctx.fillRect(0, 0, width, height)
    ctx.save()
    ctx.translate(focusX, focusY)
    // The camera follows the road with a slight drifting yaw, like a hovering drone.
    ctx.rotate(rotation)
    ctx.scale(scale, scale)
    ctx.translate(-player.x, -player.y)
    // Map the viewport center back to world space because the car sits below it.
    const offsetX = (width / 2 - focusX) / scale
    const offsetY = (height / 2 - focusY) / scale
    const worldView: GroundViewport = {
      centerX: player.x + Math.cos(rotation) * offsetX + Math.sin(rotation) * offsetY,
      centerY: player.y - Math.sin(rotation) * offsetX + Math.cos(rotation) * offsetY,
      width,
      height,
      zoom: scale,
      rotation,
      minimumZoom: baseScale * (1 - 0.035),
    }
    drawGroundTexture(ctx, worldView, night, environmentId)

    const cellSize = track.terrain.cellSize
    for (let i = 0; i < runs.length; i += terrainStride) {
      const run = runs[i]
      if (!run || (palette.shorelineBands && run.kind === 'water')) continue
      const x = run.column * cellSize
      const y = run.row * cellSize
      const runWidth = run.count * cellSize
      if (x > player.x + radius || x + runWidth < player.x - radius || Math.abs(y - player.y) > radius + cellSize) continue
      ctx.fillStyle = run.kind === 'water' ? (palette.flyoverWater ?? (night ? '#214b5c' : '#4d9cb1')) : palette.flyoverHill
      ctx.fillRect(x, y, runWidth, cellSize)
      if (run.kind === 'hill') {
        ctx.fillStyle = environmentId === 'kids-room'
          ? (night ? 'rgba(211, 181, 169, .13)' : 'rgba(255, 235, 214, .30)')
          : night ? 'rgba(181, 204, 155, .10)' : 'rgba(226, 239, 186, .18)'
        ctx.fillRect(x, y, runWidth, Math.max(2, cellSize * .12))
      }
    }
    if (waterRings.length) {
      // Use complete rings and even-odd fill to preserve land islands inside
      // water. Paint only rings intersecting the overscanned preview window.
      ctx.beginPath()
      for (const ring of waterRings) {
        if (ring.left > player.x + radius || ring.right < player.x - radius ||
          ring.top > player.y + radius || ring.bottom < player.y - radius) continue
        for (const [index, point] of ring.points.entries()) {
          if (index === 0) ctx.moveTo(point.x, point.y)
          else ctx.lineTo(point.x, point.y)
        }
        ctx.closePath()
      }
      ctx.fillStyle = night ? '#183f52' : '#287c9c'
      ctx.fill('evenodd')
      ctx.lineJoin = 'round'
      for (const band of bankBands) {
        ctx.lineWidth = band.width
        ctx.strokeStyle = `#${band.color.toString(16).padStart(6, '0')}`
        ctx.globalAlpha = band.alpha
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    if (bitmap) drawBitmapTiles(ctx, bitmap.terrain, worldView)
    const left = Math.floor((player.x - radius) / GROUND_TILE_SIZE)
    const right = Math.ceil((player.x + radius) / GROUND_TILE_SIZE)
    const top = Math.floor((player.y - radius) / GROUND_TILE_SIZE)
    const bottom = Math.ceil((player.y + radius) / GROUND_TILE_SIZE)
    const window = `${left}:${top}:${right}:${bottom}`
    if (window !== sceneryWindow) {
      sceneryWindow = window
      scenery = buildSceneryPresentation(environmentId, props, lighting, {
        left: left * GROUND_TILE_SIZE, right: right * GROUND_TILE_SIZE,
        top: top * GROUND_TILE_SIZE, bottom: bottom * GROUND_TILE_SIZE,
      })
    }
    for (const primitive of scenery) {
      ctx.fillStyle = `#${primitive.color.toString(16).padStart(6, '0')}`
      ctx.globalAlpha = primitive.alpha ?? 1
      ctx.beginPath()
      if (primitive.kind === 'ellipse') {
        ctx.ellipse(primitive.x, primitive.y, primitive.radiusX, primitive.radiusY, 0, 0, Math.PI * 2)
      } else {
        for (const [index, point] of primitive.points.entries()) {
          if (index === 0) ctx.moveTo(point.x, point.y)
          else ctx.lineTo(point.x, point.y)
        }
        ctx.closePath()
      }
      ctx.fill()
    }
    ctx.globalAlpha = 1
    for (const tree of trees) {
      if (!visible(tree.x, tree.y)) continue
      ctx.fillStyle = night ? 'rgba(0, 0, 0, .26)' : 'rgba(21, 54, 31, .24)'
      ctx.beginPath(); ctx.ellipse(tree.x + 12, tree.y + 12, 23, 13, 0, 0, Math.PI * 2); ctx.fill()
      if (bitmapArt) {
        ctx.drawImage(bitmapArt.tree, tree.x - 17, tree.y - 17, 34, 34)
        continue
      }
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
        const spec = roadColorsForEnvironment(section.a.surface, environmentId)
        ctx.beginPath(); ctx.moveTo(section.a.x, section.a.y); ctx.lineTo(section.b.x, section.b.y)
        ctx.lineWidth = edge ? ROAD_GEOMETRY.edgeWidth : ROAD_GEOMETRY.surfaceWidth
        ctx.strokeStyle = edge && section.a.structure === 'overpass' ? (night ? '#aab4b2' : '#f3e9d3') : edge ? (night ? spec.nightEdge : spec.edge) : (night ? spec.nightRoad : spec.road)
        ctx.stroke()
      }
    }
    if (bitmap) drawBitmapTiles(ctx, bitmap.road, worldView)
    // The flyover and Phaser road use identical distance-anchored material
    // strokes, so textures never switch character between preview and race.
    if (materialSections.length > 0 && (!bitmap || bitmap.road.visible(worldView).length === 0)) {
      for (const section of materialSections) {
        if (!visible(section.a.x, section.a.y) && !visible(section.b.x, section.b.y)) continue
        for (const stroke of section.strokes) {
          ctx.lineWidth = stroke.width
          ctx.strokeStyle = `#${stroke.color.toString(16).padStart(6, '0')}`
          ctx.globalAlpha = stroke.alpha
          ctx.beginPath()
          ctx.moveTo(stroke.start.x, stroke.start.y)
          ctx.lineTo(stroke.end.x, stroke.end.y)
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
    }
    // Road markings and warm pools make the direction and night scene readable at small sizes.
    ctx.setLineDash([20, 26])
    ctx.lineWidth = 2
    for (const section of sections) {
      if (!visible(section.a.x, section.a.y) && !visible(section.b.x, section.b.y)) continue
      const spec = roadColorsForEnvironment(section.a.surface, environmentId)
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
      drawCar(ctx, position(distance + direction * 100), car === 'red' ? 'yellow' : 'red', -14)
      drawCar(ctx, position(distance - direction * 95), car === 'green' ? 'blue' : 'green', 14)
    }
    drawCar(ctx, player, car, 0)
    ctx.restore()
  }
}
