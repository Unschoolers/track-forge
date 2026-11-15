import { serializeTrack } from '@/infrastructure/export/trackExport'
import { describe, expect, it } from 'vitest'
import { asTrackId, type Track } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { parseTrackImport } from '@/application/library/trackImport'
import { TrackLibraryService } from '@/application/library/trackLibraryService'
import { medalForFinish } from '@/ui/components/finishMedal'

const track = createStarterTrack(asTrackId('original'), 10)
const exported = (value: Track): string =>
  JSON.stringify({ format: 'trackforge-track', formatVersion: 1, track: value })

describe('shareable track challenges', () => {
  it('imports the existing exported document format without trusting the sender ID', () => {
    const decoded = parseTrackImport(exported(track))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.track.name).toBe(track.name)
    expect(decoded.track.points).toHaveLength(track.points.length)
    expect(decoded.track.id).not.toBe(track.id)
  })
  it('rejects malformed, oversized and dangerous shared geometry', () => {
    expect(parseTrackImport('not json').ok).toBe(false)
    expect(parseTrackImport(JSON.stringify({ format: 'other', track })).ok).toBe(false)
    expect(parseTrackImport(exported({
      ...track, points: [{ ...track.points[0]!, x: Number.POSITIVE_INFINITY }],
    })).ok).toBe(false)
    expect(parseTrackImport(exported({
      ...track, points: Array.from({ length: 2001 }, () => track.points[0]!),
    })).ok).toBe(false)
  })
  it('rejects tiny files that would expand into millions of road samples', () => {
    expect(parseTrackImport(exported({ ...track, points: [
      { x: -10_000_000, y: 0, surface: 'street' },
      { x: 10_000_000, y: 0, surface: 'street' },
    ] })).ok).toBe(false)
  })
  it('bounds the total road length even when every individual segment is small', () => {
    expect(parseTrackImport(exported({ ...track,
      points: Array.from({ length: 1000 }, (_, index) => ({
        x: index % 2 * 200, y: index, surface: 'street' as const,
      })),
    })).ok).toBe(false)
  })
  it('allows a normal-sized circuit far from the origin', () => {
    const translated = { ...track, points: track.points.map((point) => ({
      ...point, x: point.x + 1_000_000, y: point.y - 1_000_000,
    })) }
    const imported = parseTrackImport(exported(translated))
    expect(imported.ok).toBe(true)
    if (imported.ok) expect(imported.track.points[0]?.x).toBe(translated.points[0]?.x)
  })
  it('rejects dense repeated road segments before crossing pairs can exhaust memory', () => {
    expect(parseTrackImport(exported({ ...track,
      points: Array.from({ length: 1000 }, (_, index) => ({
        x: index % 2 * 60, y: 0, surface: 'street' as const, curve: 'corner' as const,
      })),
    })).ok).toBe(false)
  })
  it('does not count an artificial closing edge for an exported open draft', () => {
    expect(parseTrackImport(exported({ ...track, points: [
      { x: 0, y: 0, surface: 'street' },
      { x: 40_000, y: 0, surface: 'street' },
    ] })).ok).toBe(true)
  })
  it('imports copies rather than replacing the existing circuit or scores', () => {
    const tracks: Track[] = [track]
    let next = 0
    const library = new TrackLibraryService({
      trackStore: {
        list: () => tracks,
        find: (id) => tracks.find((t) => t.id === id),
        save: (t) => { tracks.push(t); return true },
        remove: () => true,
      },
      scoreStore: { forTrack: () => [], record: () => true, removeTrack: () => true },
      createId: () => asTrackId(`copy-${++next}`),
      now: () => 777,
    })
    const appearance = { environmentId: 'cityscape' as const, scenery: [{ kind: 'city-house' as const, x: 12, y: -4 }, { kind: 'desert-cactus' as const, x: 9, y: 3 }] }
    const source = parseTrackImport(serializeTrack({ ...track, ...appearance }).content)
    if (!source.ok) throw new Error(source.message)
    const first = library.importShared(source.track)
    const second = library.importShared(source.track)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.track).toMatchObject(appearance)
    expect(first.track.raceRevision).toBe(777)
    expect(first.track.id).toBe('copy-1')
    expect(second.track.id).toBe('copy-2')
    expect(first.track.name).toMatch(/ \(2\)$/)
    expect(second.track.name).toMatch(/ \(3\)$/)
    expect(tracks[0]).toBe(track)
  })
  it('awards finish placement medals without rewarding a DNF', () => {
    expect(medalForFinish('finished', 1)).toBe('GOLD')
    expect(medalForFinish('finished', 2)).toBe('SILVER')
    expect(medalForFinish('finished', 3)).toBe('BRONZE')
    expect(medalForFinish('finished', 4)).toBeNull()
    expect(medalForFinish('wrecked', 1)).toBeNull()
  })
})

it('round-trips all scenery and rejects oversized shared scenery', () => {
  const building = { kind: 'city-building' as const, x: 11, y: -42 }
  const scenery = [building, { kind: 'desert-rock-spire' as const, x: -7, y: 10 }]
  const parsed = parseTrackImport(serializeTrack({ ...track, environmentId: 'desert', scenery }).content)
  expect(parsed.ok).toBe(true)
  if (parsed.ok) expect(parsed.track).toMatchObject({ environmentId: 'desert', scenery })
  expect(parseTrackImport(exported({ ...track, scenery: Array.from({ length: 257 }, () => building) })).ok).toBe(false)
  const invalid = JSON.parse(exported(track))
  invalid.track.environmentId = 'unknown'
  invalid.track.scenery = [{ kind: 'city-house', x: 10, y: 20 }, { kind: 'bad', x: 0, y: 0 }, { kind: 'desert-cactus', x: 10000001, y: 0 }]
  const normalized = parseTrackImport(JSON.stringify(invalid))
  expect(normalized.ok).toBe(true)
  if (normalized.ok) expect(normalized.track).toMatchObject({ environmentId: 'grass', scenery: [{ kind: 'city-house', x: 10, y: 20 }] })
})

it('keeps the effective ghost revision through a rename', () => {
  const library = new TrackLibraryService({
    trackStore: { list: () => [track], find: () => track, save: () => true, remove: () => true },
    scoreStore: { forTrack: () => [], record: () => true, removeTrack: () => true },
    createId: () => asTrackId('new'), now: () => 99,
  })
  const result = library.rename(track.id, 'A new name')
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.track).toMatchObject({ updatedAt: 99, raceRevision: track.updatedAt })
})
