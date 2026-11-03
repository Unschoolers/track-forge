import type Phaser from 'phaser'
import {
  ROAD_GEOMETRY,
  SURFACE_SPECS,
  WORLD_ELEVATION,
} from '@/domain/config'
import type { SurfaceId, Vector2 } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import {
  projectSunShadowOntoTerrain,
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

const presentationCache = new WeakMap<
  TrackGeometry,
  readonly BridgePrimitive[]
>()

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
): readonly BridgePrimitive[] {
  const cached = presentationCache.get(geometry)
  if (cached) return cached
  const softShadows: BridgePrimitive[] = []
  const coreShadows: BridgePrimitive[] = []
  const pillars: BridgePrimitive[] = []
  const sideFaces: BridgePrimitive[] = []
  const decks: BridgePrimitive[] = []
  const markings: BridgePrimitive[] = []
  const walls: BridgePrimitive[] = []
  const { path, ribbon } = geometry
  const count = path.closed ? ribbon.length : ribbon.length - 1

  for (let index = 0; index < count; index += 1) {
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
    const currentRoad = path.roadSurface.at(index)
    const nextIndex = (index + 1) % path.points.length
    const nextRoad = path.roadSurface.at(nextIndex)
    const currentHeight = currentRoad.structureHeight
    const nextHeight = nextRoad.structureHeight
    const visibleHeight = Math.max(currentHeight, nextHeight)
    if (visibleHeight <= 0.005) continue

    const currentLeftRoad = path.roadSurface.at(index, current.edgeLeft)
    const currentRightRoad = path.roadSurface.at(index, current.edgeRight)
    const nextLeftRoad = path.roadSurface.at(nextIndex, next.edgeLeft)
    const nextRightRoad = path.roadSurface.at(nextIndex, next.edgeRight)
    const softCurrentLeft = projectSunShadowOntoTerrain(
      current.edgeLeft,
      currentLeftRoad.height,
      path.terrainSurface,
      WORLD_LIGHTING.penumbraScale,
    )
    const softNextLeft = projectSunShadowOntoTerrain(
      next.edgeLeft,
      nextLeftRoad.height,
      path.terrainSurface,
      WORLD_LIGHTING.penumbraScale,
    )
    const softNextRight = projectSunShadowOntoTerrain(
      next.edgeRight,
      nextRightRoad.height,
      path.terrainSurface,
      WORLD_LIGHTING.penumbraScale,
    )
    const softCurrentRight = projectSunShadowOntoTerrain(
      current.edgeRight,
      currentRightRoad.height,
      path.terrainSurface,
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
    const currentLeftShadow = projectSunShadowOntoTerrain(
      current.edgeLeft,
      currentLeftRoad.height,
      path.terrainSurface,
    )
    const nextLeftShadow = projectSunShadowOntoTerrain(
      next.edgeLeft,
      nextLeftRoad.height,
      path.terrainSurface,
    )
    const nextRightShadow = projectSunShadowOntoTerrain(
      next.edgeRight,
      nextRightRoad.height,
      path.terrainSurface,
    )
    const currentRightShadow = projectSunShadowOntoTerrain(
      current.edgeRight,
      currentRightRoad.height,
      path.terrainSurface,
    )
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
    const currentFaceRoad = path.roadSurface.at(index, currentFace)
    const nextFaceRoad = path.roadSurface.at(nextIndex, nextFace)
    const currentFaceGround = projectSunShadowOntoTerrain(
      currentFace,
      currentFaceRoad.height,
      path.terrainSurface,
    )
    const nextFaceGround = projectSunShadowOntoTerrain(
      nextFace,
      nextFaceRoad.height,
      path.terrainSurface,
    )
    sideFaces.push({
      kind: 'side-face',
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
    decks.push(
      {
        kind: 'edge',
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
      },
      {
        kind: 'surface',
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
    if (
      currentHeight >=
        ROAD_GEOMETRY.bridgeWallClearance * WORLD_ELEVATION.levelHeight &&
      nextHeight >=
        ROAD_GEOMETRY.bridgeWallClearance * WORLD_ELEVATION.levelHeight
    ) {
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
      const pillarGround = projectSunShadowOntoTerrain(
        current.center,
        currentRoad.height,
        path.terrainSurface,
      )
      if (pillarGround.material === 'water') continue
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
  presentationCache.set(geometry, presentation)
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
): void {
  for (const primitive of buildBridgePresentation(geometry)) {
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
  graphics: Phaser.GameObjects.Graphics,
  geometry: TrackGeometry,
  night: boolean,
): void {
  for (const primitive of buildBridgePresentation(geometry)) {
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
): void {
  for (const primitive of buildBridgePresentation(geometry)) {
    if (primitive.kind !== 'wall') continue
    stroke(graphics, primitive, 7, night ? 0x8f9aa4 : 0xd8dde1)
    stroke(graphics, primitive, 2, night ? 0x303941 : 0x59636d)
  }
}
