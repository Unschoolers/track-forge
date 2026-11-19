import type Phaser from 'phaser'
import {
  ROAD_GEOMETRY,
  SURFACE_SPECS,
  WORLD_ELEVATION,
} from '@/domain/config'
import { clamp } from '@/domain/geometry/math'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { RoadSurfaceSample } from '@/domain/track/roadSurface'
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
}

export interface BridgeLinePrimitive extends BridgePrimitiveBase {
  readonly kind: BridgeLineKind
  readonly start: Vector2
  readonly end: Vector2
}

export type BridgePrimitive =
  | BridgePolygonPrimitive
  | BridgeLinePrimitive

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
        next.center.structure !== 'overpass')
    ) {
      continue
    }
    yield
    const currentRoad = path.roadSurface.at(index)
    const nextIndex = (index + 1) % path.points.length
    const nextRoad = path.roadSurface.at(nextIndex)
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
    const nextLeftRoad = path.roadSurface.at(nextIndex, next.edgeLeft)
    const nextRightRoad = path.roadSurface.at(nextIndex, next.edgeRight)
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
    decks.push(
      deck,
      {
        kind: 'surface',
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
    if (!rampApproach) {
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
        },
      )
    }
    const currentDistance = current.center.distance
    const nextDistance =
      next.center.distance >= currentDistance
        ? next.center.distance
        : path.totalLength
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

function hex(value: string): number {
  return Number.parseInt(value.slice(1), 16)
}

function fill(
  graphics: Phaser.GameObjects.Graphics,
  polygon: readonly [Vector2, Vector2, Vector2, Vector2],
  color: number,
  alpha = 1,
): void {
  graphics.fillStyle(color, alpha)
  graphics.beginPath()
  graphics.moveTo(polygon[0].x, polygon[0].y)
  for (const point of polygon.slice(1)) graphics.lineTo(point.x, point.y)
  graphics.closePath()
  graphics.fillPath()
}

function stroke(
  graphics: Phaser.GameObjects.Graphics,
  primitive: BridgeLinePrimitive,
  width: number,
  color: number,
  alpha = 1,
): void {
  graphics.lineStyle(width, color, alpha)
  graphics.lineBetween(
    primitive.start.x,
    primitive.start.y,
    primitive.end.x,
    primitive.end.y,
  )
}

export function renderBridgeUnderlay(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night = false,
  shadowMode: TrackShadowMode = 'terrain',
): void {
  for (const primitive of buildBridgePresentation(geometry, shadowMode)) {
    if (primitive.kind === 'shadow-soft' && !night) {
      fill(graphics, primitive.polygon, 0x050807, 0.15)
    } else if (primitive.kind === 'shadow-core' && !night) {
      fill(graphics, primitive.polygon, 0x050807, 0.29)
    } else if (primitive.kind === 'pillar') {
      stroke(graphics, primitive, 11, 0x1c2422, 0.9)
    }
  }
}

export function renderBridgeDeck(
  deckGraphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
  shadowMode: TrackShadowMode = 'terrain',
  rampApproachGraphics = deckGraphics,
): void {
  for (const primitive of buildBridgePresentation(geometry, shadowMode)) {
    const graphics = primitive.rampApproach ? rampApproachGraphics : deckGraphics
    const spec = SURFACE_SPECS[primitive.surface]
    if (primitive.kind === 'edge') {
      fill(
        graphics,
        primitive.polygon,
        hex(night ? spec.nightEdge : spec.edge),
      )
    } else if (primitive.kind === 'surface') {
      fill(
        graphics,
        primitive.polygon,
        hex(night ? spec.nightRoad : spec.road),
      )
    } else if (primitive.kind === 'side-face') {
      fill(
        graphics,
        primitive.polygon,
        night ? 0x12191d : 0x343d42,
        night ? 0.92 : 0.78,
      )
    } else if (primitive.kind === 'marking') {
      stroke(
        graphics,
        primitive,
        primitive.surface === 'street' ? 2.4 : 1.7,
        hex(night ? spec.nightStripe : spec.stripe),
        0.8,
      )
    }
  }
}

export function renderBridgeSideWalls(
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
  shadowMode: TrackShadowMode = 'terrain',
): void {
  for (const primitive of buildBridgePresentation(geometry, shadowMode)) {
    if (primitive.kind !== 'wall') continue
    stroke(graphics, primitive, 7, night ? 0x8f9aa4 : 0xd8dde1)
    stroke(graphics, primitive, 2, night ? 0x303941 : 0x59636d)
  }
}
