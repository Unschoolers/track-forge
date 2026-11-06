import type Phaser from 'phaser'
import type { Vector2 } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import { ROAD_GEOMETRY, WORLD_ELEVATION } from '@/domain/config'
import {
  projectSunShadowOntoTerrain,
  WORLD_LIGHTING,
} from '@/phaser/rendering/lighting'

export interface LampPost {
  readonly position: Vector2
  readonly roadAnchor: Vector2
  readonly side: -1 | 1
  readonly height: number
  readonly baseHeight: number
  readonly terrainHeight: number
  readonly shadowEnd: Vector2
  readonly bridge: boolean
  readonly pathDistance: number
  readonly spacing: 90 | 150
}

export interface LampLight {
  readonly center: Vector2
  readonly fixture: Vector2
  readonly radius: number
  readonly intensity: number
  readonly bridge: boolean
}

const lampCache = new WeakMap<TrackGeometry, readonly LampPost[]>()
// Lamp geometry does not change during a race; avoid remapping it at 60 FPS.
const lightCache = new WeakMap<readonly LampPost[], readonly LampLight[]>()

function pointDistance(left: Vector2, right: Vector2): number {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function circularDistance(
  left: number,
  right: number,
  total: number,
): number {
  const direct = Math.abs(left - right)
  return Math.min(direct, Math.max(0, total - direct))
}

export function buildLampPosts(
  geometry: TrackGeometry,
): readonly LampPost[] {
  const cached = lampCache.get(geometry)
  if (cached) return cached
  const { path, ribbon } = geometry
  if (path.totalLength <= 0 || ribbon.length === 0) return []

  const posts: LampPost[] = []
  const offset = ROAD_GEOMETRY.edgeWidth / 2 + 11
  let nextDistance = 0
  let nextSide: -1 | 1 = -1
  for (const [index, sample] of ribbon.entries()) {
    if (sample.center.distance + 0.001 < nextDistance) continue
    const roadSurface = path.roadSurface.at(index)
    const bridge =
      roadSurface.structureHeight >=
      ROAD_GEOMETRY.bridgeWallClearance * WORLD_ELEVATION.levelHeight
    const spacing = bridge ? 90 : 150
    nextDistance = sample.center.distance + spacing

    if (
      circularDistance(
        sample.center.distance,
        geometry.start.distance,
        path.totalLength,
      ) < 72
    ) {
      continue
    }
    if (
      geometry.crossings.some(
        (crossing) =>
          crossing.upperSegment === null &&
          pointDistance(sample.center, crossing.position) < 64,
      )
    ) {
      continue
    }

    const side: -1 | 1 = nextSide
    nextSide = side === -1 ? 1 : -1
    const position = {
      x: sample.center.x + sample.normal.x * offset * side,
      y: sample.center.y + sample.normal.y * offset * side,
    }
    if (
      posts.some((post) => pointDistance(position, post.position) < 54)
    ) {
      continue
    }
    const height = 18
    const localRoad = path.roadSurface.at(index, position)
    const shadow = projectSunShadowOntoTerrain(
      position,
      localRoad.height + height,
      path.terrainSurface,
    )
    posts.push({
      position,
      roadAnchor: {
        x: sample.center.x + sample.normal.x * 8 * side,
        y: sample.center.y + sample.normal.y * 8 * side,
      },
      side,
      height,
      baseHeight: localRoad.height,
      terrainHeight: shadow.terrainHeight,
      shadowEnd: shadow.point,
      bridge,
      pathDistance: sample.center.distance,
      spacing,
    })
  }
  lampCache.set(geometry, posts)
  return posts
}

export function buildLampLights(
  posts: readonly LampPost[],
): readonly LampLight[] {
  const cached = lightCache.get(posts)
  if (cached) return cached
  const lights = posts.map((post) => ({
    center: post.roadAnchor,
    fixture: post.position,
    radius: post.bridge ? 54 : 46,
    intensity: post.bridge ? 0.1 : 0.082,
    bridge: post.bridge,
  }))
  lightCache.set(posts, lights)
  return lights
}

export function renderLampPosts(
  graphics: Phaser.GameObjects.Graphics,
  posts: readonly LampPost[],
  night: boolean,
): void {
  for (const post of posts) {
    const top = {
      x: post.position.x - WORLD_LIGHTING.sunShadowDirection.x * 5,
      y: post.position.y - WORLD_LIGHTING.sunShadowDirection.y * 5,
    }
    if (!night) {
      graphics.lineStyle(3.2, 0x17201c, 0.24)
      graphics.lineBetween(
        post.position.x,
        post.position.y,
        post.shadowEnd.x,
        post.shadowEnd.y,
      )
    }
    graphics.lineStyle(3.4, night ? 0x7b8790 : 0x4a5558, 1)
    graphics.lineBetween(
      post.position.x,
      post.position.y,
      top.x,
      top.y,
    )
    graphics.fillStyle(night ? 0xffe4a3 : 0xd8dde0, 1)
    graphics.fillCircle(top.x, top.y, night ? 3.2 : 2.6)
    graphics.fillStyle(0x242d30, 1)
    graphics.fillCircle(post.position.x, post.position.y, 2.2)
  }
}
