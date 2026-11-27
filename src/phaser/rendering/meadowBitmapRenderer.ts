import type Phaser from 'phaser'
import type { TerrainMap } from '@/domain/model'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { BITMAP_TILE_LIMIT, createEditorHillBitmapTiles, createEditorRoadBitmapLayers, createEditorWaterBitmapTiles, type BitmapTiles } from '@/presentation/environments/meadowBitmapTiles'
import { GROUND_TILE_SIZE, groundViewportBounds, type GroundTile, type GroundViewport, type WorldBounds } from '@/presentation/environments/groundTexture'
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
const FRAME_RESERVE_MS = 3
const MAX_FRAME_INTERVAL_MS = 1000 / 60
const HEADING_BUCKETS = 24
let nextRenderer = 0

interface CachedImage {
  readonly image: Phaser.GameObjects.Image
  readonly texture: string
  lastUsed: number
}

interface BitmapTileUploadOwner {
  wants(key: string): boolean
  prepare(tile: GroundTile): HTMLCanvasElement
  upload(tile: GroundTile, key: string, canvas: HTMLCanvasElement): void
}

export interface BitmapWorkSample {
  readonly operation: 'prepare' | 'upload'
  readonly layer: number
  readonly tile: string
  readonly priority: number
  readonly durationMs: number
}
export type BitmapWorkObserver = (sample: BitmapWorkSample) => void

export interface UploadRequest {
  readonly owner: BitmapTileUploadOwner
  readonly tile: GroundTile
  readonly key: string
  readonly priority: number
  readonly primaryDistance: number
  readonly secondaryDistance: number
  readonly layerOrder: number
  readonly ownerOrder: number
}

/** One bounded texture upload per display frame, shared across the bitmap layers. */
export class BitmapTileUploadScheduler {
  private readonly requests = new Map<string, UploadRequest>()
  private prepared: { request: UploadRequest; canvas: HTMLCanvasElement } | undefined
  private frameStart: number | undefined
  private destroyed = false

  constructor(private readonly scene: Phaser.Scene, private readonly now = () => performance.now(),
    private readonly observe?: BitmapWorkObserver) {
    scene.game.events.on('prestep', this.beginFrame)
    scene.game.events.on('postrender', this.processOne)
  }

  private readonly beginFrame = (): void => {
    this.frameStart = this.now()
  }

  replace(owner: BitmapTileUploadOwner, requests: readonly UploadRequest[]): void {
    if (this.destroyed) return
    for (const [id, request] of this.requests) {
      if (request.owner === owner) this.requests.delete(id)
    }
    for (const request of requests) {
      this.requests.set(`${request.ownerOrder}:${request.key}`, request)
    }
  }

  cancel(owner: BitmapTileUploadOwner): void {
    if (this.prepared?.request.owner === owner) this.prepared = undefined
    for (const [id, request] of this.requests) {
      if (request.owner === owner) this.requests.delete(id)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.requests.clear()
    this.prepared = undefined
    this.scene.game.events.off('prestep', this.beginFrame)
    this.scene.game.events.off('postrender', this.processOne)
  }

  /** Startup-only: complete current-window textures before the first scene frame.
   * Never drain speculative requests on the synchronous startup path. */
  warmVisible(): void {
    if (this.destroyed) return
    for (let next = this.bestRequest(); next?.priority === 0; next = this.bestRequest()) {
      const canvas = this.takePrepared(next) ?? next.owner.prepare(next.tile)
      this.requests.delete(this.requestId(next))
      next.owner.upload(next.tile, next.key, canvas)
    }
  }

  private requestId(request: UploadRequest): string {
    return `${request.ownerOrder}:${request.key}`
  }

  private bestRequest(): UploadRequest | undefined {
    let best: UploadRequest | undefined
    for (const [id, request] of this.requests) {
      if (!request.owner.wants(request.key)) {
        this.requests.delete(id)
        continue
      }
      if (!best || compareRequests(request, best) < 0) best = request
    }
    return best
  }

  private takePrepared(request: UploadRequest): HTMLCanvasElement | undefined {
    if (this.prepared?.request.owner !== request.owner || this.prepared.request.key !== request.key) return undefined
    const { canvas } = this.prepared
    this.prepared = undefined
    return canvas
  }

  private readonly processOne = (): void => {
    if (this.destroyed || this.frameStart === undefined) return
    const start = this.frameStart
    this.frameStart = undefined
    const interval = this.scene.game.loop.rawDelta
    const budget = Math.min(MAX_FRAME_INTERVAL_MS, interval > 0 ? interval : MAX_FRAME_INTERVAL_MS) - FRAME_RESERVE_MS
    if (this.now() - start >= budget) return
    const best = this.bestRequest()
    if (!best) {
      this.prepared = undefined
      return
    }
    // Finish prepared visible work even if distance priorities moved slightly.
    // A new visible request may displace speculative prepared work.
    const pending = this.prepared
    const live = pending && this.requests.get(this.requestId(pending.request))
    const next = live && live.owner.wants(live.key) && live.priority <= best.priority ? live : best
    const canvas = this.takePrepared(next)
    if (canvas) {
      this.requests.delete(this.requestId(next))
      this.measure(next, 'upload', () => next.owner.upload(next.tile, next.key, canvas))
    } else {
      this.prepared = { request: next, canvas: this.measure(next, 'prepare', () => next.owner.prepare(next.tile)) }
    }
  }

  private measure<T>(request: UploadRequest, operation: BitmapWorkSample['operation'], work: () => T): T {
    if (!this.observe) return work()
    const start = this.now()
    try { return work() }
    finally {
      this.observe({ operation, layer: request.layerOrder, tile: request.key,
        priority: request.priority, durationMs: this.now() - start })
    }
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
export class BitmapTileRenderer {
  readonly order = ++nextRenderer
  private readonly images = new Map<string, CachedImage>()
  private readonly current = new Set<string>()
  private readonly wanted = new Set<string>()
  private selectionSignature = ''
  private currentSignature: string | undefined
  private wantedSignature: string | undefined
  private clock = 0
  private destroyed = false
  private suspended = false
  private visibleResident = 0

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly scheduler: BitmapTileUploadScheduler,
    private tiles: BitmapTiles,
    private readonly depth: number,
    private readonly layerOrder: number,
    private readonly tileLimit: number = BITMAP_TILE_LIMIT,
    private readonly coherentWindow = false,
  ) {}

  render(view: GroundViewport, bounds?: WorldBounds): void {
    if (this.destroyed || this.suspended) return
    const window = bounds ?? groundViewportBounds(view)
    const grid = [window.left, window.top, window.right, window.bottom]
      .map(edge => Math.floor(edge / GROUND_TILE_SIZE)).join(':')
    // Tile membership depends on grid bounds and the bitmap zoom cutoff.
    // Directional priorities only need refreshing at meaningful camera changes.
    const heading = bounds ? Math.round(view.rotation * HEADING_BUCKETS / (2 * Math.PI)) : 0
    const center = bounds ? `${Math.floor(view.centerX / (GROUND_TILE_SIZE / 2))}:${Math.floor(view.centerY / (GROUND_TILE_SIZE / 2))}` : ''
    const selection = `${grid}:${Math.min(view.zoom, view.minimumZoom ?? view.zoom) < 0.18}:${heading}:${center}`
    if (selection === this.selectionSignature) return
    this.selectionSignature = selection
    const currentTiles = this.tiles.visible(view, window)
    const prefetchTiles = bounds || this.coherentWindow ? this.tiles.visible(view, expanded(window)) : currentTiles
    const currentSignature = currentTiles.map(tileKey).join('|')
    const maxPrefetch = Math.max(0, Math.min(
      MAX_PREFETCH_TILES_PER_LAYER,
      this.tileLimit - currentTiles.length,
    ))
    const currentKeys = new Set(currentTiles.map(tileKey))
    const distance = (tile: GroundTile): number => Math.hypot(
      (tile.x + 0.5) * GROUND_TILE_SIZE - view.centerX,
      (tile.y + 0.5) * GROUND_TILE_SIZE - view.centerY,
    )
    const prefetched = this.coherentWindow
      ? prefetchTiles.filter(tile => !currentKeys.has(tileKey(tile)))
        .sort((left, right) => distance(left) - distance(right) || left.y - right.y || left.x - right.x)
        .slice(0, maxPrefetch)
      : selectAheadTiles(view, currentTiles, prefetchTiles, maxPrefetch)
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

    this.visibleResident = 0
    for (const [key, item] of this.images) {
      const visible = this.current.has(key)
      if (visible) this.visibleResident++
      if (!this.coherentWindow && item.image.visible !== visible) item.image.setVisible(visible)
      if (this.wanted.has(key)) this.touch(key, item)
    }
    if (this.coherentWindow) this.syncWindowVisibility()

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

  setSuspended(suspended: boolean): void {
    if (this.destroyed || this.suspended === suspended) return
    this.suspended = suspended
    this.scheduler.cancel(this)
    this.selectionSignature = ''
    this.currentSignature = undefined
    this.wantedSignature = undefined
    if (suspended) {
      for (const item of this.images.values()) {
        if (item.image.visible) item.image.setVisible(false)
      }
    }
  }

  /** Reconcile only after a committed geometry change. Retain GPU textures
   * whose exact painter inputs are unchanged; never reuse an unknown key.
   * Cancel old prepared work before switching sources. */
  replaceTiles(tiles: BitmapTiles): void {
    if (this.destroyed || this.tiles === tiles) return
    this.scheduler.cancel(this)
    for (const [key, item] of this.images) {
      const previous = this.tiles.tileContentKey?.(key)
      const next = tiles.tileContentKey?.(key)
      if (previous !== undefined && previous === next) continue
      this.remove(item)
      this.images.delete(key)
    }
    this.tiles = tiles
    this.selectionSignature = ''
    this.currentSignature = undefined
    this.wantedSignature = undefined
    this.visibleResident = 0
    this.current.clear()
    this.wanted.clear()
  }

  /** Counts only; do not enumerate tiles or inspect GPU state in the hot path. */
  writeCoverage(target: number[]): void {
    const offset = this.layerOrder * 3
    target[offset] = this.current.size
    target[offset + 1] = this.visibleResident
    target[offset + 2] = this.images.size
  }

  wants(key: string): boolean {
    return !this.destroyed && !this.suspended && this.wanted.has(key) && !this.images.has(key)
  }

  prepare(tile: GroundTile): HTMLCanvasElement {
    return this.tiles.image(tile)
  }

  upload(tile: GroundTile, key: string, canvas: HTMLCanvasElement): void {
    if (!this.wants(key)) return
    this.ensureCapacity()
    if (this.images.size >= this.tileLimit) return
    const texture = `meadow-layer-${this.order}:${key}`
    const registered = this.scene.textures.addCanvas(texture, canvas)
    if (!registered) throw new Error('Could not register Meadow bitmap tile')
    try {
      const image = this.scene.add.image(tile.x * GROUND_TILE_SIZE, tile.y * GROUND_TILE_SIZE, texture)
        .setOrigin(0).setDepth(this.depth).setVisible(!this.coherentWindow && this.current.has(key))
      this.touch(key, { image, texture, lastUsed: ++this.clock })
      if (this.current.has(key)) this.visibleResident++
      if (this.coherentWindow && this.current.has(key) && this.visibleResident === this.current.size) {
        this.syncWindowVisibility()
      }
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
    this.selectionSignature = ''
    this.currentSignature = ''
    this.wantedSignature = ''
    for (const item of this.images.values()) this.remove(item)
    this.images.clear()
  }

  private syncWindowVisibility(): void {
    const ready = this.current.size > 0 && this.visibleResident === this.current.size
    for (const [key, item] of this.images) {
      const visible = ready && this.current.has(key)
      if (item.image.visible !== visible) item.image.setVisible(visible)
    }
  }

  private ensureCapacity(): void {
    // Retain offscreen textures within the existing hard cap. Evict only
    // when an actual upload requires space, not merely because a tile left view.
    if (this.images.size < this.tileLimit) return
    // Evict stale tiles before any requested tile. Current tiles are never
    // sacrificed for speculation.
    if (!this.evictOldest(key => !this.wanted.has(key))) {
      this.evictOldest(key => !this.current.has(key))
    }
  }

  private evictOldest(eligible: (key: string) => boolean): boolean {
    let oldestKey: string | undefined
    let oldestUsed = Infinity
    for (const [key, item] of this.images) {
      if (eligible(key) && item.lastUsed < oldestUsed) {
        oldestKey = key
        oldestUsed = item.lastUsed
      }
    }
    if (oldestKey === undefined) return false
    const item = this.images.get(oldestKey)
    if (!item) return false
    this.remove(item)
    this.images.delete(oldestKey)
    return true
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
  warmVisible(): void
  coverage(): readonly number[]
  destroy(): void
}

/** Only the editable scene owns mutable geometry and material lifetimes. */
export interface EditorMeadowBitmapRenderer extends MeadowBitmapRenderer {
  update(geometry: TrackGeometry, terrain: TerrainMap, hillInfluence: string, gestureActive: boolean, night: boolean, environment: TrackEnvironmentId): void
  hasRoadLayers(): boolean
}

/** Scene-lifetime owner. Water is independent of road geometry; hills are not. */
export function createMeadowBitmapRenderer(scene: Phaser.Scene, shadowMode: TrackShadowMode = 'terrain', observe?: BitmapWorkObserver): EditorMeadowBitmapRenderer {
  const scheduler = new BitmapTileUploadScheduler(scene, undefined, observe)
  let water: BitmapTileRenderer | undefined
  let hill: BitmapTileRenderer | undefined
  let previousHillInfluence: string | undefined
  let roadLayers: BitmapTileRenderer[] = []
  let previousTerrain: TerrainMap | undefined
  let previousEnvironment: TrackEnvironmentId | undefined
  let previousNight: boolean | undefined
  let waterLimit = BITMAP_TILE_LIMIT as number
  let hillLimit = BITMAP_TILE_LIMIT as number
  let hasWater = false
  let hasHill = false
  let destroyed = false

  const destroyRoadLayers = () => {
    for (const renderer of roadLayers) renderer.destroy()
    roadLayers = []
  }
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    scene.events.off('shutdown', destroy)
    water?.destroy()
    water = undefined
    hill?.destroy()
    hill = undefined
    destroyRoadLayers()
    scheduler.destroy()
  }
  scene.events.once('shutdown', destroy)
  const renderers = (): readonly BitmapTileRenderer[] => [
    ...(water ? [water] : []), ...(hill ? [hill] : []), ...roadLayers,
  ]
  return {
    update(geometry, terrain, hillInfluence, gestureActive, night, environment) {
      if (destroyed) return
      const changed = previousTerrain !== terrain || previousNight !== night || previousEnvironment !== environment
      if (changed) {
        water?.destroy()
        water = undefined
        previousTerrain = terrain
        previousNight = night
        previousEnvironment = environment
        hasWater = terrain.cells.some(cell => cell.kind === 'water')
        hasHill = terrain.cells.some(cell => cell.kind === 'hill')
        // Keep the original combined terrain cap even when the map contains
        // both materials. Each source and GPU cache enforces its allocation.
        waterLimit = hasHill ? BITMAP_TILE_LIMIT / 2 : BITMAP_TILE_LIMIT
        hillLimit = hasWater ? BITMAP_TILE_LIMIT / 2 : BITMAP_TILE_LIMIT
      }
      if (changed) {
        hill?.destroy()
        hill = undefined
        previousHillInfluence = undefined
      }
      destroyRoadLayers()
      // Preserve the committed hill bitmap during an unrelated live gesture.
      // If slope influence changes, hide that pass until commit so stale hill
      // shading cannot cover the updated vector geometry.
      if (gestureActive) {
        if (hill && previousHillInfluence !== hillInfluence) hill.setSuspended(true)
        return
      }
      if (hasWater && !water) {
        const tiles = createEditorWaterBitmapTiles(geometry, night, environment, waterLimit)
        if (tiles) water = new BitmapTileRenderer(scene, scheduler, tiles, WORLD_RENDER_DEPTH.terrain + 0.2, 1, waterLimit, true)
      }
      if (hasHill && (!hill || previousHillInfluence !== hillInfluence)) {
        const tiles = createEditorHillBitmapTiles(geometry, night, environment, hillLimit)
        if (tiles) {
          if (hill) hill.replaceTiles(tiles)
          else hill = new BitmapTileRenderer(scene, scheduler, tiles, WORLD_RENDER_DEPTH.terrain + 0.21, 4, hillLimit, true)
          previousHillInfluence = hillInfluence
        } else {
          hill?.destroy()
          hill = undefined
        }
      }
      hill?.setSuspended(false)
      const layers = createEditorRoadBitmapLayers(geometry, night, environment, shadowMode)
      if (!layers) return
      roadLayers = [
        new BitmapTileRenderer(scene, scheduler, layers.road, ROAD_BITMAP_DEPTH, 0),
        ...(layers.bridgeApproach ? [new BitmapTileRenderer(scene, scheduler, layers.bridgeApproach, BRIDGE_APPROACH_BITMAP_DEPTH, 2)] : []),
        ...(layers.bridgeDeck ? [new BitmapTileRenderer(scene, scheduler, layers.bridgeDeck, BRIDGE_DECK_BITMAP_DEPTH, 3)] : []),
      ]
    },
    hasRoadLayers: () => roadLayers.length > 0,
    render(view, bounds) {
      for (const renderer of renderers()) renderer.render(view, bounds)
    },
    warmVisible: () => scheduler.warmVisible(),
    coverage: () => {
      const counts = Array<number>(15).fill(0)
      for (const renderer of renderers()) renderer.writeCoverage(counts)
      return counts
    },
    destroy,
  }
}
