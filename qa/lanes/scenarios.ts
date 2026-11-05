import { asTrackId, type Track, type TrackPoint } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { BrowserTrackRepository } from '@/infrastructure/storage/trackRepository'
import { buildRoadPath, type RoadPath } from '@/domain/track/pathBuilder'
import { validateTrack } from '@/domain/track/trackValidation'

export const SCENARIO_IDS = ['starter', 'hairpin', 'bridge'] as const

/** Bound compilation work before expanding externally supplied geometry. */
export function prepareLanePath(track: Track): RoadPath {
	if (track.points.length > 2000)
		throw new Error(`${track.name}: QA control-point budget exceeded (2000)`)
	// Length is measured after compilation; all other raceability checks apply now.
	const preliminary = validateTrack(track, Number.MAX_SAFE_INTEGER)
	if (!preliminary.ready)
		throw new Error(`${track.name}: ${preliminary.code}: ${preliminary.message}`)
	const controls = track.points.slice(0, -1)
	let estimatedSamples = 0
	for (const [index, point] of controls.entries()) {
		const next = controls[(index + 1) % controls.length]
		if (!next) continue
		estimatedSamples += Math.max(
			4,
			Math.ceil(Math.hypot(next.x - point.x, next.y - point.y) / 9),
		)
		if (estimatedSamples > 10000)
			throw new Error(
				`${track.name}: QA geometry-sample budget exceeded (10000)`,
			)
	}
	const path = buildRoadPath(track.points, track.terrain)
	const validation = validateTrack(track, path.totalLength)
	if (!validation.ready) throw new Error(`${track.name}: ${validation.message}`)
	return path
}

export function createLaneScenarios(): Track[] {
	const starter = createStarterTrack(asTrackId('starter'), 1)
	const fixture = (
		id: string,
		name: string,
		points: readonly TrackPoint[],
	): Track => ({
		...starter,
		id: asTrackId(id),
		name,
		trees: [],
		points: points.map((point, index) => ({ ...point, id: `${id}-${index}` })),
	})
	const hairpin = [
		[-300, -180],
		[0, -180],
		[240, -180],
		[300, -120],
		[240, -60],
		[0, -60],
		[-120, -60],
		[-180, 0],
		[-120, 60],
		[120, 60],
		[240, 120],
		[240, 240],
		[-300, 240],
		[-300, 80],
		[-300, -80],
		[-300, -180],
	].map(([x, y]) => ({ x: x ?? 0, y: y ?? 0, surface: 'street' as const }))
	return [
		starter,
		fixture('hairpin', 'Hairpin circuit', hairpin),
		fixture('bridge', 'Bridge crossing', [
			{ x: -84, y: -70, surface: 'street' },
			{ x: 84, y: 70, surface: 'street' },
			{ x: -84, y: 70, surface: 'street', structure: 'overpass' },
			{ x: 84, y: -70, surface: 'street' },
			{ x: 300, y: -70, surface: 'street' },
			{ x: 300, y: -300, surface: 'street' },
			{ x: -300, y: -300, surface: 'street' },
			{ x: -300, y: -70, surface: 'street' },
			{ x: -84, y: -70, surface: 'street' },
		]),
	]
}

/** Reuse the app's migrations/validation; no parallel track-file format. */
export function decodeTrackInput(input: unknown): Track[] {
	const raw = Array.isArray(input) ? input : [input]
	if (raw.length === 0) throw new Error('Track input is empty')
	const storage = new Map<string, string>()
	const repository = new BrowserTrackRepository(
		{
			get: (key) => storage.get(key) ?? null,
			set: (key, value) => {
				storage.set(key, value)
				return true
			},
			remove: (key) => {
				storage.delete(key)
				return true
			},
		},
		{ now: () => 1 },
	)
	const tracks: Track[] = []
	for (const value of raw) {
		try {
			if (!repository.save(value as Track)) throw new Error('Invalid track')
			const id = (value as Track).id
			const track = repository.find(id)
			if (!track) throw new Error('Invalid track')
			tracks.push(track)
		} catch {
			throw new Error(`Invalid track at input index ${tracks.length}`)
		}
	}
	return tracks
}
