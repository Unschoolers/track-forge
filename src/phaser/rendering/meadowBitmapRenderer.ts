import type Phaser from 'phaser'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { BITMAP_TILE_LIMIT, createMeadowBitmapLayers, type BitmapTiles } from '@/presentation/environments/meadowBitmapTiles'
import { GROUND_TILE_SIZE, type GroundTile, type GroundViewport, type WorldBounds } from '@/presentation/environments/groundTexture'
import { WORLD_RENDER_DEPTH } from './renderLayers'
import type { TrackShadowMode } from './lighting'

export const ROAD_BITMAP_DEPTH = WORLD_RENDER_DEPTH.road + 0.2
export const ROAD_MARKINGS_DEPTH = WORLD_RENDER_DEPTH.road + 0.4
export const BRIDGE_APPROACH_BITMAP_DEPTH = WORLD_RENDER_DEPTH.structureUnderlay + 0.2
export const BRIDGE_DECK_BITMAP_DEPTH = WORLD_RENDER_DEPTH.structureDeck + 0.2
const PREFETCH_GUTTER_TILES = 1
// Keep a small directional cushion beyond the active viewport. The total
// texture budget remains shared with visible tiles, so large zoomed-out
// views naturally disable prefetch rather than increasing memory use.
const MAX_PREFETCH_TILES_PER_LAYER = 8
let nextRenderer = 0

interface CachedImage {
  readonly image: Phaser.GameObjects.Image
  readonly texture: string
  lastUsed: number
}

interface UploadRequest {
  readonly owner: BitmapTileRenderer
  readonly tile: GroundTile
  readonly key: string
  readonly priority: number
  readonly primaryDistance: number
  readonly secondaryDistance: number
  readonly layerOrder: number
  readonly ownerOrder: number
}

/** One bounded texture upload per display frame, shared across the bitmap layers. */
class BitmapTileUploadScheduler {
  private readonly requests = new Map<string, UploadRequest>()
  private destroyed = false

  constructor(private readonly scene: Phaser.Scene) {
    scene.game.events.on('postrender', this.processOne)
  }

  replace(owner: BitmapTileRenderer, requests: readonly UploadRequest[]): void {
    if (this.destroyed) return
    for (const [id, request] of this.requests) {
      if (request.owner === owner) this.requests.delete(id)
    }
    for (const request of requests) {
      this.requests.set(`${request.ownerOrder}:${request.key}`, request)
    }
  }

  cancel(owner: BitmapTileRenderer): void {
    for (const [id, request] of this.requests) {
      if (request.owner === owner) this.requests.delete(id)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.requests.clear()
    this.scene.game.events.off('postrender', this.processOne)
  }

  private readonly processOne = (): void => {
    if (this.destroyed) return
    let bestId: string | undefined
    let best: UploadRequest | undefined
    for (const [id, request] of this.requests) {
      if (!request.owner.wants(request.key)) {
        this.requests.delete(id)
        continue
      }
      if (!best || compareRequests(request, best) < 0) {
        best = request
        bestId = id
      }
    }
    if (!best || bestId === undefined) return
    this.requests.delete(bestId)
    best.owner.upload(best.tile, best.key)
  }
}

function compareRequests(left: UploadRequest, right: UploadRequest): number {
  return left.priority - right.priority ||
    left.primaryDistance - right.primaryDistance ||
    left.secondaryDistance - right.secondaryDistance ||
    left.layerOrder - right.layerOrder ||
    left.tile.y - right.tile.y ||
    left.tile.x - right.tile.x ||
    left.ownerOrder - right.ownerOrder
}

function tileKey(tile: Pick<GroundTile, 'x' | 'y'>): string {
  return `${tile.x}:${tile.y}`
}

function expanded(bounds: WorldBounds): WorldBounds {
  const margin = GROUND_TILE_SIZE * PREFETCH_GUTTER_TILES
  return {
    left: bounds.left - margin,
    top: bounds.top - margin,
    right: bounds.right + margin,
    bottom: bounds.bottom + margin,
  }
}

/** Select the nearest, most centered tiles ahead of the camera for gradual uploads. */
export function selectAheadTiles(
  view: GroundViewport,
  current: readonly GroundTile[],
  candidates: readonly GroundTile[],
  limit: number,
): readonly GroundTile[] {
  if (limit <= 0) return []
  const currentKeys = new Set(current.map(tileKey))
  const ahead = -view.rotation - Math.PI / 2
  const forwardX = Math.cos(ahead)
  const forwardY = Math.sin(ahead)
  return candidates
    .filter(tile => !currentKeys.has(tileKey(tile)))
    .map(tile => {
      const dx = tile.x * GROUND_TILE_SIZE + GROUND_TILE_SIZE / 2 - view.centerX
      const dy = tile.y * GROUND_TILE_SIZE + GROUND_TILE_SIZE / 2 - view.centerY
      return { tile, forward: dx * forwardX + dy * forwardY, lateral: Math.abs(dx * forwardY - dy * forwardX) }
    })
    .filter(candidate => candidate.forward > 0)
    .sort((left, right) => left.lateral - right.lateral || left.forward - right.forward ||
      left.tile.y - right.tile.y || left.tile.x - right.tile.x)
    .slice(0, limit)
    .map(candidate => candidate.tile)
}

/** Only current and nearby prefetched tiles own GPU textures; no full-track atlas is allocated. */
class BitmapTileRenderer {
  readonly order = ++nextRenderer
  private readonly images = new Map<string, CachedImage>()
  private readonly current = new Set<string>()
  private readonly wanted = new Set<string>()
  private currentSignature = ''
  private wantedSignature = ''
  private clock = 0
  private destroyed = false

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly scheduler: BitmapTileUploadScheduler,
    private readonly tiles: BitmapTiles,
    private readonly depth: number,
    private readonly layerOrder: number,
  ) {}

  render(view: GroundViewport, bounds?: WorldBounds): void {
    if (this.destroyed) return
    const currentTiles = this.tiles.visible(view, bounds)
    const prefetchTiles = bounds ? this.tiles.visible(view, expanded(bounds)) : currentTiles
    const currentSignature = currentTiles.map(tileKey).join('|')
    const maxPrefetch = Math.max(0, Math.min(
      MAX_PREFETCH_TILES_PER_LAYER,
      BITMAP_TILE_LIMIT - currentTiles.length,
    ))
    const prefetched = selectAheadTiles(view, currentTiles, prefetchTiles, maxPrefetch)
    const candidates = [...currentTiles, ...prefetched]
    const wantedSignature = candidates.map(tileKey).join('|')
    // The editor calls render every frame. Stable tile windows do not need
    // set, queue or display-object churn; the POST_RENDER scheduler polls
    // independently and still drains outstanding requests.
    if (currentSignature === this.currentSignature && wantedSignature === this.wantedSignature) return
    this.currentSignature = currentSignature
    this.wantedSignature = wantedSignature
    this.current.clear()
    this.wanted.clear()
    for (const tile of currentTiles) this.current.add(tileKey(tile))
    for (const tile of candidates) this.wanted.add(tileKey(tile))

    for (const [key, item] of this.images) {
      const visible = this.current.has(key)
      if (item.image.visible !== visible) item.image.setVisible(visible)
      if (this.wanted.has(key)) this.touch(key, item)
    }

    const requests: UploadRequest[] = []
    const addRequest = (tile: GroundTile, priority: number) => {
      const key = tileKey(tile)
      if (this.images.has(key)) return
      const dx = tile.x * GROUND_TILE_SIZE + GROUND_TILE_SIZE / 2 - view.centerX
      const dy = tile.y * GROUND_TILE_SIZE + GROUND_TILE_SIZE / 2 - view.centerY
      requests.push({
        owner: this,
        tile,
        key,
        priority,
        // Finish tiles under the current camera first. Directional prefetch is
        // secondary, after distance to center has been used for visible tiles.
        primaryDistance: Math.hypot(dx, dy),
        secondaryDistance: 0,
        layerOrder: this.layerOrder,
        ownerOrder: this.order,
      })
    }
    for (const tile of currentTiles) addRequest(tile, 0)
    for (const tile of candidates) {
      if (!this.current.has(tileKey(tile))) addRequest(tile, 1)
    }
    this.scheduler.replace(this, requests)
  }

  wants(key: string): boolean {
    return !this.destroyed && this.wanted.has(key) && !this.images.has(key)
  }

  upload(tile: GroundTile, key: string): void {
    if (!this.wants(key)) return
    this.ensureCapacity()
    if (this.images.size >= BITMAP_TILE_LIMIT) return
    const texture = `meadow-layer-${this.order}:${key}`
    const registered = this.scene.textures.addCanvas(texture, this.tiles.image(tile))
    if (!registered) throw new Error('Could not register Meadow bitmap tile')
    try {
      const image = this.scene.add.image(tile.x * GROUND_TILE_SIZE, tile.y * GROUND_TILE_SIZE, texture)
        .setOrigin(0).setDepth(this.depth).setVisible(this.current.has(key))
      this.touch(key, { image, texture, lastUsed: ++this.clock })
    } catch (error) {
      this.scene.textures.remove(texture)
      throw error
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.scheduler.cancel(this)
    this.current.clear()
    this.wanted.clear()
    this.currentSignature = ''
    this.wantedSignature = ''
    for (const item of this.images.values()) this.remove(item)
    this.images.clear()
  }

  private ensureCapacity(): void {
    while (this.images.size >= BITMAP_TILE_LIMIT) {
      let oldestKey: string | undefined
      let oldestUsed = Infinity
      for (const [key, item] of this.images) {
        // Keep current tiles resident, but let urgent visible requests evict
        // prefetched entries even when the cache is otherwise protected.
        if (this.current.has(key)) continue
        const lastUsed = item.lastUsed
        if (lastUsed < oldestUsed) {
          oldestUsed = lastUsed
          oldestKey = key
        }
      }
      if (oldestKey === undefined) {
        // A current miss cannot be blocked by prefetched cache entries. The
        // current set itself is bounded to BITMAP_TILE_LIMIT.
        for (const [key, item] of this.images) {
          const lastUsed = item.lastUsed
          if (lastUsed < oldestUsed) {
            oldestUsed = lastUsed
            oldestKey = key
          }
        }
      }
      if (oldestKey === undefined) return
      const item = this.images.get(oldestKey)
      if (!item) return
      this.remove(item)
      this.images.delete(oldestKey)
    }
  }

  private touch(key: string, item: CachedImage): void {
    item.lastUsed = ++this.clock
    if (!this.images.has(key)) this.images.set(key, item)
  }

  private remove(item: CachedImage): void {
    item.image.destroy()
    this.scene.textures.remove(item.texture)
  }
}

export interface MeadowBitmapRenderer {
  render(view: GroundViewport, bounds?: WorldBounds): void
  destroy(): void
}

export function createMeadowBitmapRenderer(scene: Phaser.Scene, geometry: TrackGeometry, night: boolean, environment: TrackEnvironmentId, shadowMode: TrackShadowMode = 'terrain'): MeadowBitmapRenderer | undefined {
  const layers = createMeadowBitmapLayers(geometry, night, environment, shadowMode)
  if (!layers) return undefined
  const scheduler = new BitmapTileUploadScheduler(scene)
  const renderers = [
    new BitmapTileRenderer(scene, scheduler, layers.road, ROAD_BITMAP_DEPTH, 0),
    new BitmapTileRenderer(scene, scheduler, layers.terrain, WORLD_RENDER_DEPTH.terrain + 0.2, 1),
    ...(layers.bridgeApproach ? [new BitmapTileRenderer(scene, scheduler, layers.bridgeApproach, BRIDGE_APPROACH_BITMAP_DEPTH, 2)] : []),
    ...(layers.bridgeDeck ? [new BitmapTileRenderer(scene, scheduler, layers.bridgeDeck, BRIDGE_DECK_BITMAP_DEPTH, 3)] : []),
  ]
  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    scene.events.off('shutdown', destroy)
    scheduler.destroy()
    for (const renderer of renderers) renderer.destroy()
  }
  scene.events.once('shutdown', destroy)
  return {
    render(view, bounds) {
      for (const renderer of renderers) renderer.render(view, bounds)
    },
    destroy,
  }
}
