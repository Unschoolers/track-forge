import { isSurfaceId, isLightingMode, asTrackId, type Track, type TrackPoint } from '@/domain/model'
import { normalizeTerrain } from '@/domain/terrain/terrainField'

export type TrackImportResult =
  | { readonly ok: true; readonly track: Track }
  | { readonly ok: false; readonly message: string }

const MAX_FILE_CHARS = 2_000_000
const MAX_POINTS = 2_000
const MAX_TREES = 5_000
const MAX_TERRAIN_CELLS = 20_000

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000_000
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Shared-file imports are treated as untrusted; the library supplies a fresh ID. */
export function parseTrackImport(content: string): TrackImportResult {
  if (content.length > MAX_FILE_CHARS) {
    return { ok: false, message: 'Track file is too large to import.' }
  }
  let parsed: unknown
  try { parsed = JSON.parse(content) as unknown }
  catch { return { ok: false, message: 'Invalid track JSON file.' } }
  const envelope = object(parsed)
  if (envelope?.format !== 'trackforge-track' || envelope.formatVersion !== 1) {
    return { ok: false, message: 'Not a supported Track Forge export.' }
  }
  const source = object(envelope.track)
  if (!source) return { ok: false, message: 'Track contents are missing.' }
  const name = typeof source?.name === 'string'
    ? source.name.replace(/\s+/g, ' ').trim().slice(0, 32)
    : ''
  const points = source?.points
  const trees = source?.trees
  const terrain = object(source?.terrain)
  if (!name || !Array.isArray(points) || points.length > MAX_POINTS ||
      !Array.isArray(trees) || trees.length > MAX_TREES ||
      (Array.isArray(terrain?.cells) && terrain.cells.length > MAX_TERRAIN_CELLS)) {
    return { ok: false, message: 'The shared track has invalid or oversized geometry.' }
  }
  if (!points.every((value) => {
    const p = object(value)
    return p && finite(p.x) && finite(p.y) && isSurfaceId(p.surface)
  }) || !trees.every((value) => {
    const tree = object(value)
    return tree && finite(tree.x) && finite(tree.y)
  })) {
    return { ok: false, message: 'The shared track contains invalid coordinates or surfaces.' }
  }
  const normalizedPoints: TrackPoint[] = points.map((value, index) => {
    const p = object(value)!
    return {
      x: p.x as number,
      y: p.y as number,
      surface: p.surface as TrackPoint['surface'],
      id: typeof p.id === 'string' ? p.id.slice(0, 64) : `point-${index}`,
      curve: p.curve === 'corner' ? 'corner' : 'smooth',
      tension: finite(p.tension) ? Math.max(0, Math.min(1, p.tension)) : 0.5,
      structure: p.structure === 'overpass' ? 'overpass' : 'surface',
    }
  })
  const start = object(source.start)
  const now = Date.now()
  return {
    ok: true,
    track: {
      id: asTrackId('untrusted-shared-track'),
      name,
      version: 8,
      points: normalizedPoints,
      trees: trees.map((value) => {
        const t = object(value)!
        return { x: t.x as number, y: t.y as number }
      }),
      terrain: normalizeTerrain(source.terrain),
      start: {
        ratio: finite(start?.ratio) ? Math.max(0, Math.min(0.999999, start.ratio)) : 0,
        reversed: start?.reversed === true,
      },
      lighting: isLightingMode(source.lighting) ? source.lighting : 'day',
      createdAt: now,
      updatedAt: now,
    },
  }
}
