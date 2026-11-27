import type Phaser from 'phaser'
import {
  ROAD_GEOMETRY,
  WORLD_ELEVATION,
} from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { RoadRibbonQuad } from '@/presentation/environments/roadRibbonQuads'
import { bridgePaintCommands, type BridgePaintCommand } from '@/presentation/environments/bridgeMaterials'
import type { RoadSurfaceSample } from '@/domain/track/roadSurface'
import type { WorldBounds } from '@/presentation/environments/groundTexture'
import {
  projectSunShadowOntoLocalGround,
  projectSunShadowOntoTerrain,
  type TrackShadowMode,
  WORLD_LIGHTING,
} from '@/phaser/rendering/lighting'

type BridgePolygonKind =
  | 'shadow-soft'
  | 'shadow-core'
  | 'side-face'
  | 'edge'
  | 'surface'
type BridgeLineKind = 'pillar' | 'marking' | 'wall'

interface BridgePrimitiveBase {
  readonly surface: SurfaceId
  readonly projectedDistance: number
  readonly deckHeight: number
  readonly terrainHeight: number
  readonly rampApproach?: boolean
}

export interface BridgePolygonPrimitive extends BridgePrimitiveBase {
  readonly kind: BridgePolygonKind
  readonly polygon: readonly [Vector2, Vector2, Vector2, Vector2]
  readonly deckHeights: readonly [number, number]
  readonly terrainHeights: readonly [number, number]
  readonly roadQuad?: RoadRibbonQuad
}

export interface BridgeLinePrimitive extends BridgePrimitiveBase {
  readonly kind: BridgeLineKind
  readonly start: Vector2
  readonly end: Vector2
  readonly distanceSpan?: readonly [number, number]
}

export type BridgePrimitive =
  | BridgePolygonPrimitive
  | BridgeLinePrimitive

export interface BridgeRenderPasses {
  readonly underlay: readonly BridgePrimitive[]
  readonly rampApproach: readonly BridgePrimitive[]
  readonly deck: readonly BridgePrimitive[]
  readonly walls: readonly BridgePrimitive[]
}

/** Partitions presentation data into the renderer's depth passes without
 * changing item order within a pass or allowing a primitive into two passes. */
export function bridgeRenderPasses(primitives: readonly BridgePrimitive[]): BridgeRenderPasses {
  const underlay: BridgePrimitive[] = []
  const rampApproach: BridgePrimitive[] = []
  const deck: BridgePrimitive[] = []
  const walls: BridgePrimitive[] = []
  for (const primitive of primitives) {
    if (primitive.kind === 'wall') walls.push(primitive)
    else if (primitive.kind === 'shadow-soft' || primitive.kind === 'shadow-core' || primitive.kind === 'pillar') underlay.push(primitive)
    else if (primitive.rampApproach) rampApproach.push(primitive)
    else deck.push(primitive)
  }
  return { underlay, rampApproach, deck, walls }
}

export interface BridgeSpatialBatch {
  readonly items: readonly BridgePrimitive[]
  readonly bounds: WorldBounds
}

/** Groups consecutive bridge commands so batching cannot change painter order. */
export function chunkBridgePrimitives(
  primitives: readonly BridgePrimitive[],
  size = 64,
): readonly BridgeSpatialBatch[] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('Chunk size must be a positive integer')
  const batches: BridgeSpatialBatch[] = []
  for (let start = 0; start < primitives.length; start += size) {
    const items = primitives.slice(start, start + size)
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    for (const item of items) {
      const points = 'polygon' in item ? item.polygon : [item.start, item.end]
      for (const point of points) {
        left = Math.min(left, point.x)
        top = Math.min(top, point.y)
        right = Math.max(right, point.x)
        bottom = Math.max(bottom, point.y)
      }
    }
    // Rails, bevels, and shadow softness can extend beyond the base primitive.
    batches.push({ items, bounds: { left: left - 12, top: top - 12, right: right + 12, bottom: bottom + 12 } })
  }
  return batches
}

const presentationCaches: Record<TrackShadowMode, WeakMap<TrackGeometry, readonly BridgePrimitive[]>> = {
  terrain: new WeakMap(),
  'local-ground': new WeakMap(),
}

function shadowDistance(height: number, scale = 1): number {
  return (
    height *
    WORLD_LIGHTING.shadowLengthPerHeight *
    scale
  )
}

function elevationBase(
  surface: SurfaceId,
  deckHeight: number,
  terrainHeight: number,
  projectedDistance: number,
): BridgePrimitiveBase {
  return {
    surface,
    projectedDistance,
    deckHeight,
    terrainHeight,
  }
}

export function buildBridgePresentation(
  geometry: TrackGeometry,
  shadowMode: TrackShadowMode = 'terrain',
): readonly BridgePrimitive[] {
  const cached = presentationCaches[shadowMode].get(geometry)
  if (cached) return cached
  const work = prepareBridgePresentation(geometry, shadowMode)
  let step = work.next()
  while (!step.done) step = work.next()
  return step.value
}

export type BridgeDeckOcclusion = (position: Vector2 & { readonly z: number }) => boolean

const deckOcclusionCache = new WeakMap<TrackGeometry, BridgeDeckOcclusion>()

export function getBridgeDeckOcclusion(geometry: TrackGeometry): BridgeDeckOcclusion {
  buildBridgePresentation(geometry)
  return deckOcclusionCache.get(geometry) ?? (() => false)
}

function deckCell(coordinate: number): number {
  return Math.floor(coordinate / ROAD_GEOMETRY.edgeWidth)
}

function indexBridgeDeck(
  cells: Map<string, BridgePolygonPrimitive[]>,
  deck: BridgePolygonPrimitive,
): void {
  const xs = deck.polygon.map(({ x }) => deckCell(x))
  const ys = deck.polygon.map(({ y }) => deckCell(y))
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  for (let x = Math.min(...xs); x <= right; x++) {
    for (let y = Math.min(...ys); y <= bottom; y++) {
      const key = `${x}:${y}`
      const cell = cells.get(key)
      if (cell) cell.push(deck)
      else cells.set(key, [deck])
    }
  }
}

function deckHeightAt(deck: BridgePolygonPrimitive, point: Vector2): number {
  const [leftStart, leftEnd, rightEnd, rightStart] = deck.polygon
  const startX = (leftStart.x + rightStart.x) / 2
  const startY = (leftStart.y + rightStart.y) / 2
  const dx = (leftEnd.x + rightEnd.x) / 2 - startX
  const dy = (leftEnd.y + rightEnd.y) / 2 - startY
  const lengthSquared = dx * dx + dy * dy
  const ratio = lengthSquared > 0
    ? clamp(((point.x - startX) * dx + (point.y - startY) * dy) / lengthSquared, 0, 1)
    : 0
  const [startHeight, endHeight] = deck.deckHeights
  return startHeight + (endHeight - startHeight) * ratio
}

function containsDeckPoint(
  [a, b, c, d]: BridgePolygonPrimitive['polygon'],
  point: Vector2,
): boolean {
  const crossesRay = (start: Vector2, end: Vector2) =>
    (start.y > point.y) !== (end.y > point.y) &&
    point.x < start.x + (end.x - start.x) * (point.y - start.y) / (end.y - start.y)
  const crossings = Number(crossesRay(a, b)) + Number(crossesRay(b, c)) +
    Number(crossesRay(c, d)) + Number(crossesRay(d, a))
  return crossings % 2 === 1
}

/** Builds the same presentation as the synchronous renderer one section at a time. */
export function* prepareBridgePresentation(
  geometry: TrackGeometry,
  shadowMode: TrackShadowMode = 'terrain',
): Generator<void, readonly BridgePrimitive[], void> {
  const cache = presentationCaches[shadowMode]
  const cached = cache.get(geometry)
  if (cached) return cached
  const softShadows: BridgePrimitive[] = []
  const coreShadows: BridgePrimitive[] = []
  const pillars: BridgePrimitive[] = []
  const sideFaces: BridgePrimitive[] = []
  const decks: BridgePrimitive[] = []
  const markings: BridgePrimitive[] = []
  const walls: BridgePrimitive[] = []
  const deckCells = new Map<string, BridgePolygonPrimitive[]>()
  const { path, ribbon } = geometry
  const count = path.closed ? ribbon.length : ribbon.length - 1
  const projectShadow = (point: Vector2, road: RoadSurfaceSample, scale = 1) =>
    shadowMode === 'local-ground'
      ? projectSunShadowOntoLocalGround(point, road.height, road.terrainHeight, scale)
      : projectSunShadowOntoTerrain(point, road.height, path.terrainSurface, scale)

  for (let index = 0; index < count; index += 1) {
    if (index % 64 === 0) yield
    const current = ribbon[index]
    const next = ribbon[(index + 1) % ribbon.length]
    if (
      !current ||
      !next ||
      (current.center.structure !== 'overpass' &&
        next.center.structure !== 'overpass' && current.center.structure !== 'jump')
    ) {
      continue
    }
    yield
    const currentRoad = path.roadSurface.at(index)
    const nextIndex = (index + 1) % path.points.length
    const jump = current.center.structure === 'jump'
    const jumpLip = jump && next.center.structure !== 'jump'
    const nextRoad = jumpLip ? path.roadSurface.atSegmentEnd(index) : path.roadSurface.at(nextIndex)
    const currentHeight = currentRoad.structureHeight
    const nextHeight = nextRoad.structureHeight
    const visibleHeight = Math.max(currentHeight, nextHeight)
    if (visibleHeight <= 0.005) continue
    const wallClearance = ROAD_GEOMETRY.bridgeWallClearance * WORLD_ELEVATION.levelHeight
    // The nose of a car overlaps the ramp before its center reaches the
    // deck layer. Treat these shallow strips as part of the ground road.
    const rampApproach = Math.min(currentHeight, nextHeight) < wallClearance

    const currentLeftRoad = path.roadSurface.at(index, current.edgeLeft)
    const currentRightRoad = path.roadSurface.at(index, current.edgeRight)
    const nextLeftRoad = jumpLip ? path.roadSurface.atSegmentEnd(index, next.edgeLeft) : path.roadSurface.at(nextIndex, next.edgeLeft)
    const nextRightRoad = jumpLip ? path.roadSurface.atSegmentEnd(index, next.edgeRight) : path.roadSurface.at(nextIndex, next.edgeRight)
    const softCurrentLeft = projectShadow(
      current.edgeLeft,
      currentLeftRoad,
      WORLD_LIGHTING.penumbraScale,
    )
    const softNextLeft = projectShadow(
      next.edgeLeft,
      nextLeftRoad,
      WORLD_LIGHTING.penumbraScale,
    )
    yield
    const softNextRight = projectShadow(
      next.edgeRight,
      nextRightRoad,
      WORLD_LIGHTING.penumbraScale,
    )
    const softCurrentRight = projectShadow(
      current.edgeRight,
      currentRightRoad,
      WORLD_LIGHTING.penumbraScale,
    )
    const softClearance = Math.max(
      softCurrentLeft.clearance,
      softNextLeft.clearance,
      softNextRight.clearance,
      softCurrentRight.clearance,
    )
    softShadows.push({
      kind: 'shadow-soft',
      ...elevationBase(
        current.surface,
        currentRoad.height,
        softCurrentLeft.terrainHeight,
        shadowDistance(
          softClearance,
          WORLD_LIGHTING.penumbraScale,
        ),
      ),
      polygon: [
        softCurrentLeft.point,
        softNextLeft.point,
        softNextRight.point,
        softCurrentRight.point,
      ],
      deckHeights: [currentRoad.height, nextRoad.height],
      terrainHeights: [
        softCurrentLeft.terrainHeight,
        softNextLeft.terrainHeight,
      ],
    })
    yield
    const currentLeftShadow = projectShadow(current.edgeLeft, currentLeftRoad)
    const nextLeftShadow = projectShadow(next.edgeLeft, nextLeftRoad)
    yield
    const nextRightShadow = projectShadow(next.edgeRight, nextRightRoad)
    const currentRightShadow = projectShadow(current.edgeRight, currentRightRoad)
    const coreClearance = Math.max(
      currentLeftShadow.clearance,
      nextLeftShadow.clearance,
      nextRightShadow.clearance,
      currentRightShadow.clearance,
    )
    coreShadows.push({
      kind: 'shadow-core',
      ...elevationBase(
        current.surface,
        currentRoad.height,
        currentLeftShadow.terrainHeight,
        shadowDistance(coreClearance),
      ),
      polygon: [
        currentLeftShadow.point,
        nextLeftShadow.point,
        nextRightShadow.point,
        currentRightShadow.point,
      ],
      deckHeights: [currentRoad.height, nextRoad.height],
      terrainHeights: [
        currentLeftShadow.terrainHeight,
        nextLeftShadow.terrainHeight,
      ],
    })
    const segmentLength = Math.max(
      0.001,
      Math.hypot(
        next.center.x - current.center.x,
        next.center.y - current.center.y,
      ),
    )
    const leftNormal = {
      x: -(next.center.y - current.center.y) / segmentLength,
      y: (next.center.x - current.center.x) / segmentLength,
    }
    const shadowOnLeft =
      leftNormal.x * WORLD_LIGHTING.sunShadowDirection.x +
        leftNormal.y * WORLD_LIGHTING.sunShadowDirection.y >
      0
    const currentFace = shadowOnLeft
      ? current.edgeLeft
      : current.edgeRight
    const nextFace = shadowOnLeft ? next.edgeLeft : next.edgeRight
    const currentFaceRoad = shadowOnLeft ? currentLeftRoad : currentRightRoad
    const nextFaceRoad = shadowOnLeft ? nextLeftRoad : nextRightRoad
    const currentFaceGround = shadowOnLeft ? currentLeftShadow : currentRightShadow
    const nextFaceGround = shadowOnLeft ? nextLeftShadow : nextRightShadow
    sideFaces.push({
      kind: 'side-face',
      rampApproach,
      ...elevationBase(
        current.surface,
        currentFaceRoad.height,
        currentFaceGround.terrainHeight,
        shadowDistance(
          Math.max(
            currentFaceGround.clearance,
            nextFaceGround.clearance,
          ),
        ),
      ),
      polygon: [
        currentFace,
        nextFace,
        nextFaceGround.point,
        currentFaceGround.point,
      ],
      deckHeights: [currentFaceRoad.height, nextFaceRoad.height],
      terrainHeights: [
        currentFaceGround.terrainHeight,
        nextFaceGround.terrainHeight,
      ],
    })
    if (jumpLip) {
      // The ramp ends here, not on a fabricated descending road strip.
      sideFaces.push({
        kind: 'side-face',
        ...elevationBase(current.surface, nextRoad.height, nextRoad.terrainHeight, shadowDistance(nextHeight)),
        polygon: [next.edgeLeft, next.edgeRight, nextRightShadow.point, nextLeftShadow.point],
        deckHeights: [nextRoad.height, nextRoad.height],
        terrainHeights: [nextLeftRoad.terrainHeight, nextRightRoad.terrainHeight],
      })
    }
    const deck: BridgePolygonPrimitive = {
      kind: 'edge',
      rampApproach,
      ...elevationBase(
        current.surface,
        currentRoad.height,
        currentRoad.terrainHeight,
        0,
      ),
      polygon: [
        current.edgeLeft,
        next.edgeLeft,
        next.edgeRight,
        current.edgeRight,
      ],
      deckHeights: [currentRoad.height, nextRoad.height],
      terrainHeights: [
        currentRoad.terrainHeight,
        nextRoad.terrainHeight,
      ],
    }
    if (shadowMode === 'terrain' && !rampApproach) indexBridgeDeck(deckCells, deck)
    const currentDistance = current.center.distance
    const nextDistance = next.center.distance >= currentDistance ? next.center.distance : path.totalLength
    decks.push(
      deck,
      {
        kind: 'surface',
        roadQuad: {
          surface: current.surface, from: current.center,
          to: nextDistance === next.center.distance ? next.center : { ...next.center, distance: nextDistance },
          edge: deck.polygon, road: [current.left, next.left, next.right, current.right],
        },
        rampApproach,
        ...elevationBase(
          current.surface,
          currentRoad.height,
          currentRoad.terrainHeight,
          0,
        ),
        polygon: [
          current.left,
          next.left,
          next.right,
          current.right,
        ],
        deckHeights: [currentRoad.height, nextRoad.height],
        terrainHeights: [
          currentRoad.terrainHeight,
          nextRoad.terrainHeight,
        ],
      },
    )
    if (index % 3 === 0) {
      markings.push({
        kind: 'marking',
        rampApproach,
        ...elevationBase(
          current.surface,
          currentRoad.height,
          currentRoad.terrainHeight,
          0,
        ),
        start: current.center,
        end: next.center,
      })
    }
    if (!rampApproach && !jump) {
      walls.push(
        {
          kind: 'wall',
          ...elevationBase(
            current.surface,
            currentRoad.height,
            currentRoad.terrainHeight,
            0,
          ),
          start: current.left,
          end: next.left,
          distanceSpan: [currentDistance, nextDistance],
        },
        {
          kind: 'wall',
          ...elevationBase(
            current.surface,
            currentRoad.height,
            currentRoad.terrainHeight,
            0,
          ),
          start: current.right,
          end: next.right,
          distanceSpan: [currentDistance, nextDistance],
        },
      )
    }
    if (
      currentHeight >= WORLD_ELEVATION.levelHeight * 0.99 &&
      nextHeight >= WORLD_ELEVATION.levelHeight * 0.99 &&
      Math.floor(currentDistance / ROAD_GEOMETRY.bridgePillarSpacing) !==
        Math.floor(nextDistance / ROAD_GEOMETRY.bridgePillarSpacing)
    ) {
      const pillarGround = projectShadow(current.center, currentRoad)
      if (path.terrainSurface.materialAt(pillarGround.point) === 'water') continue
      pillars.push({
        kind: 'pillar',
        ...elevationBase(
          current.surface,
          currentRoad.height,
          pillarGround.terrainHeight,
          shadowDistance(pillarGround.clearance),
        ),
        start: current.center,
        end: pillarGround.point,
      })
    }
  }
  const presentation = [
    ...softShadows,
    ...coreShadows,
    ...pillars,
    ...sideFaces,
    ...decks,
    ...markings,
    ...walls,
  ]
  const completed = cache.get(geometry)
  if (completed) return completed
  cache.set(geometry, presentation)
  if (shadowMode === 'terrain') {
    deckOcclusionCache.set(geometry, (position) =>
      deckCells.get(`${deckCell(position.x)}:${deckCell(position.y)}`)?.some((deck) =>
        containsDeckPoint(deck.polygon, position) && position.z < deckHeightAt(deck, position) - 2,
      ) ?? false,
    )
  }
  return presentation
}

function paint(graphics: Phaser.GameObjects.Graphics, commands: readonly BridgePaintCommand[]): void {
  for (const command of commands) {
    if (command.kind === 'fill') {
      graphics.fillStyle(command.color, command.alpha)
      const [a, b, c, d] = command.polygon
      graphics.beginPath()
      graphics.moveTo(a.x, a.y)
      graphics.lineTo(b.x, b.y)
      graphics.lineTo(c.x, c.y)
      graphics.lineTo(d.x, d.y)
      graphics.closePath()
      graphics.fillPath()
    } else {
      graphics.lineStyle(command.width, command.color, command.alpha)
      graphics.lineBetween(command.start.x, command.start.y, command.end.x, command.end.y)
    }
  }
}

export function renderBridgeUnderlay(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night = false,
  shadowMode: TrackShadowMode = 'terrain',
  environment: TrackEnvironmentId = 'grass',
  presentation = buildBridgePresentation(geometry, shadowMode),
): void {
  for (const primitive of presentation) {
    if (primitive.kind === 'shadow-soft' || primitive.kind === 'shadow-core' || primitive.kind === 'pillar') {
      paint(graphics, bridgePaintCommands(primitive, environment, night))
    }
  }
}

export function renderBridgeDeck(
  deckGraphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
  shadowMode: TrackShadowMode = 'terrain',
  rampApproachGraphics = deckGraphics,
  environment: TrackEnvironmentId = 'grass',
  presentation = buildBridgePresentation(geometry, shadowMode),
): void {
  const loopLength = geometry.path.closed ? geometry.path.totalLength : undefined
  for (const primitive of presentation) {
    if (primitive.kind !== 'edge' && primitive.kind !== 'surface' && primitive.kind !== 'side-face' && primitive.kind !== 'marking') continue
    const graphics = primitive.rampApproach ? rampApproachGraphics : deckGraphics
    paint(graphics, bridgePaintCommands(primitive, environment, night, false, loopLength))
  }
}

export function renderBridgeSideWalls(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
  shadowMode: TrackShadowMode = 'terrain',
  environment: TrackEnvironmentId = 'grass',
  presentation = buildBridgePresentation(geometry, shadowMode),
): void {
  for (const primitive of presentation) {
    if (primitive.kind === 'wall') paint(graphics, bridgePaintCommands(primitive, environment, night))
  }
}
