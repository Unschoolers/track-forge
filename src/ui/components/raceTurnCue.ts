import type { RoadPath } from '@/domain/track/pathBuilder'

export interface RaceTurnCue {
	readonly direction: 'left' | 'right'
	/** Approximate world distance from the player's current sample to the turn. */
	readonly distance: number
}

const TURN_THRESHOLD_RADIANS = Math.PI / 6
const TANGENT_SPAN = 3
const MIN_PERSISTENT_HEADINGS = 3
const MAX_LOOKAHEAD_SAMPLES = 48

/**
 * Finds the first sustained change in the sampled road heading ahead of the
 * player. The fixed scan budget keeps this suitable for per-frame HUD updates.
 */
export function upcomingRaceTurnCue(
	path: RoadPath,
	playerPathIndex: number,
	reversed: boolean,
): RaceTurnCue | null {
	if (!Array.isArray(path?.points)) return null
	const count = path.points.length
	if (
		count < TANGENT_SPAN * 2 + MIN_PERSISTENT_HEADINGS ||
		!Number.isInteger(playerPathIndex) ||
		playerPathIndex < 0 ||
		playerPathIndex >= count
	)
		return null

	const step = reversed ? -1 : 1
	const sample = (ahead: number) => {
		const index = playerPathIndex + step * ahead
		if (!path.closed && (index < 0 || index >= count)) return undefined
		const wrapped = ((index % count) + count) % count
		const point = path.points[wrapped]
		return point && Number.isFinite(point.x) && Number.isFinite(point.y)
			? point
			: undefined
	}
	const origin = sample(0)
	const baselineStart = sample(-TANGENT_SPAN)
	const baselineEnd = baselineStart ? origin : sample(TANGENT_SPAN)
	if (!origin || !baselineEnd) return null
	const baselineX = baselineStart
		? origin.x - baselineStart.x
		: baselineEnd.x - origin.x
	const baselineY = baselineStart
		? origin.y - baselineStart.y
		: baselineEnd.y - origin.y
	if (Math.hypot(baselineX, baselineY) < 0.001) return null

	let cumulativeDistance = 0
	let previous = origin
	let persistentDirection: 'left' | 'right' | null = null
	let persistentCount = 0
	let candidateDistance = 0
	const openPathRemaining =
		step > 0 ? count - playerPathIndex - 1 : playerPathIndex
	const lookaheadLimit = Math.min(
		MAX_LOOKAHEAD_SAMPLES,
		path.closed ? count - 1 : openPathRemaining,
	)

	for (let ahead = 1; ahead <= lookaheadLimit; ahead += 1) {
		const current = sample(ahead)
		if (!current) break
		cumulativeDistance += Math.hypot(
			current.x - previous.x,
			current.y - previous.y,
		)
		previous = current
		if (ahead < TANGENT_SPAN) continue

		const start = sample(ahead - TANGENT_SPAN)
		const end = sample(ahead)
		if (!start || !end) break
		const tangentX = end.x - start.x
		const tangentY = end.y - start.y
		if (Math.hypot(tangentX, tangentY) < 0.001) {
			persistentDirection = null
			persistentCount = 0
			continue
		}
		const cross = baselineX * tangentY - baselineY * tangentX
		const dot = baselineX * tangentX + baselineY * tangentY
		const angle = Math.atan2(cross, dot)
		// A near-reversal has no useful left/right side for a small HUD arrow.
		if (Math.abs(angle) >= (Math.PI * 5) / 6) {
			persistentDirection = null
			persistentCount = 0
			continue
		}
		const direction =
			angle >= TURN_THRESHOLD_RADIANS
				? 'right'
				: angle <= -TURN_THRESHOLD_RADIANS
					? 'left'
					: null
		if (!direction) {
			persistentDirection = null
			persistentCount = 0
		} else if (direction === persistentDirection) {
			persistentCount += 1
		} else {
			persistentDirection = direction
			persistentCount = 1
			candidateDistance = cumulativeDistance
		}
		if (persistentCount >= MIN_PERSISTENT_HEADINGS && persistentDirection) {
			return {
				direction: persistentDirection,
				distance: Math.max(0, candidateDistance),
			}
		}
	}
	return null
}
