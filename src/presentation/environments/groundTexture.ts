/** World-space grass tiles. Coordinates in GroundTile are tile indices. */
export const GROUND_TILE_SIZE = 256
// Compact/mobile editing retains its original inexpensive tile budget.
// Large PC windows need more *visible sprites*, not more baked textures:
// all sprites share the same eight deterministic material variants.
const COMPACT_TILE_BUDGET = 64
const LARGE_VIEW_TILE_BUDGET = 768
const LARGE_VIEW_PIXEL_AREA = 1_000_000
// The largest patch radius, plus a little room for camera motion.
const VIEW_MARGIN = 64
export const GROUND_TILE_VARIANTS = 8

export interface GroundTile {
  readonly x: number
  readonly y: number
  readonly variant: number
}

export interface WorldBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface GroundViewport {
  readonly centerX: number
  readonly centerY: number
  readonly width: number
  readonly height: number
  readonly zoom: number
  readonly rotation: number
  /** Budget for the camera's widest view when zoom changes during animation. */
  readonly minimumZoom?: number
}

/** Empty means the window is too large to texture and should use the base fill. */
export function visibleGroundTiles(bounds: WorldBounds, maxTiles = COMPACT_TILE_BUDGET): GroundTile[] {
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) || bounds.right < bounds.left || bounds.bottom < bounds.top) return []
  const left = Math.floor(bounds.left / GROUND_TILE_SIZE)
  const right = Math.floor(bounds.right / GROUND_TILE_SIZE)
  const top = Math.floor(bounds.top / GROUND_TILE_SIZE)
  const bottom = Math.floor(bounds.bottom / GROUND_TILE_SIZE)
  if (![left, right, top, bottom].every(Number.isSafeInteger)) return []
  if ((right - left + 1) * (bottom - top + 1) > maxTiles) return []
  const tiles: GroundTile[] = []
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const hash = Math.imul(x, 73856093) ^ Math.imul(y, 19349663)
      tiles.push({ x, y, variant: (hash >>> 0) % GROUND_TILE_VARIANTS })
    }
  }
  return tiles
}

export function groundViewportBounds(view: GroundViewport): WorldBounds {
  const zoom = Math.max(Math.abs(view.zoom), 0.000001)
  const cos = Math.abs(Math.cos(view.rotation))
  const sin = Math.abs(Math.sin(view.rotation))
  const halfWidth = (view.width * cos + view.height * sin) / (2 * zoom) + VIEW_MARGIN
  const halfHeight = (view.width * sin + view.height * cos) / (2 * zoom) + VIEW_MARGIN
  return { left: view.centerX - halfWidth, right: view.centerX + halfWidth, top: view.centerY - halfHeight, bottom: view.centerY + halfHeight }
}

/** Choose overview fallback from viewport size alone, so panning or rotation
 * cannot make ground details blink in and out around the tile budget. */
export function visibleGroundTilesForViewport(view: GroundViewport): readonly GroundTile[] {
  const budgetZoom = Math.min(view.zoom, view.minimumZoom ?? view.zoom)
  if (
    ![view.centerX, view.centerY, view.width, view.height, view.zoom, view.rotation, budgetZoom].every(Number.isFinite) ||
    view.width <= 0 || view.height <= 0 || budgetZoom <= 0
  ) return []
  const maxTiles = view.width * view.height >= LARGE_VIEW_PIXEL_AREA
    ? LARGE_VIEW_TILE_BUDGET
    : COMPACT_TILE_BUDGET
  // The rotated viewport's bounding-box area and perimeter are maximal at 45°.
  // Estimate that square rather than the diagonal squared (which incorrectly
  // disables grass on ordinary desktop screens). Include one alignment tile
  // per axis so the overview decision cannot flicker as the camera moves.
  const rotatedSpan = (view.width + view.height) / Math.SQRT2 / budgetZoom + 2 * VIEW_MARGIN
  const maxAxisTiles = Math.ceil(rotatedSpan / GROUND_TILE_SIZE) + 1
  if (maxAxisTiles * maxAxisTiles > maxTiles) return []
  return visibleGroundTiles(groundViewportBounds(view), maxTiles)
}

/** Stable per-variant noise for cached ground art. Never use Math.random() here:
 * panning, editor reloads and the flyover must paint exactly the same material. */
export function createGroundTileRandom(variant: number, salt: number): () => number {
  let state = (Math.imul((variant | 0) + 1, 747_796_405) ^ salt) >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}
