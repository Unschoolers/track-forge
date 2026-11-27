// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { GhostPose } from '@/application/race/ghostReplay'
import type { RaceSessionSnapshot } from '@/application/race/raceSession'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { createRaceMinimap } from '@/ui/components/raceMinimap'

function pose(x: number, y: number, car: GhostPose['car'] = 'red'): GhostPose {
	return { t: 0, x, y, angle: 0, z: 0, structureRunId: null, car }
}

function snapshot(
	overrides: Partial<RaceSessionSnapshot> = {},
): RaceSessionSnapshot {
	const track = createStarterTrack(asTrackId('minimap'), 3)
	const path = new TrackGeometryService().get(track).path
	return {
		runId: 1,
		track,
		setup: null,
		state: {
			path,
			vehicles: [
				{ id: 'player', player: true, x: 20, y: 30, finishedAt: null },
				{ id: 'rival', player: false, x: 45, y: 60, finishedAt: null },
				{ id: 'finished', player: false, x: 80, y: 90, finishedAt: 5 },
			],
		} as never,
		standings: [],
		result: null,
		telemetry: {} as never,
		...overrides,
	}
}

function raceState(
	value: RaceSessionSnapshot,
): NonNullable<RaceSessionSnapshot['state']> {
	if (!value.state) throw new Error('Expected a race state')
	return value.state
}

function requiredElement<T extends Element>(value: T | null, label: string): T {
	if (!value) throw new Error(`Expected ${label}`)
	return value
}

describe('race minimap', () => {
	it('shows a static route and distinct player and active AI markers at world positions', () => {
		const minimap = createRaceMinimap()
		expect(minimap.element.classList.contains('race-minimap')).toBe(true)
		expect(minimap.element.hidden).toBe(true)
		minimap.update(snapshot(), [])

		expect(minimap.element.querySelector('svg')).not.toBeNull()
		expect(minimap.element.querySelector('[data-kind="player"]')).not.toBeNull()
		expect(
			minimap.element.querySelector('[data-kind="vehicle"]'),
		).not.toBeNull()
		expect(
			minimap.element.querySelectorAll('[data-kind="vehicle"]'),
		).toHaveLength(2)
		expect(
			minimap.element.querySelector('[data-kind="player"]')?.getAttribute('cx'),
		).not.toBe('20')
	})

	it('includes nearby poses and a saved ghost, then hides stale markers when absent', () => {
		const minimap = createRaceMinimap()
		minimap.update({ ...snapshot(), ghost: pose(70, 30) }, [pose(30, 70)])
		expect(minimap.element.querySelector('[data-kind="nearby"]')).not.toBeNull()
		expect(minimap.element.querySelector('[data-kind="ghost"]')).not.toBeNull()

		minimap.update(snapshot(), [])
		expect(minimap.element.querySelector('[data-kind="nearby"]')).toBeNull()
		expect(minimap.element.querySelector('[data-kind="ghost"]')).toBeNull()
	})

	it('reuses marker elements, clamps off-map positions, and resets markers for a new run', () => {
		const minimap = createRaceMinimap()
		const initial = snapshot()
		minimap.update(initial, [])
		const player = minimap.element.querySelector('[data-kind="player"]')
		const route = minimap.element.querySelector('[data-kind="route"]')
		const nextState = {
			...initial.state,
			vehicles: [
				{ id: 'player', player: true, x: 1e9, y: -1e9, finishedAt: null },
			],
		}
		minimap.update({ ...initial, state: nextState as never }, [])
		expect(minimap.element.querySelector('[data-kind="player"]')).toBe(player)
		expect(minimap.element.querySelector('[data-kind="route"]')).toBe(route)
		const marker = player as SVGCircleElement
		expect(Number(marker.getAttribute('cx'))).toBeGreaterThanOrEqual(0)
		expect(Number(marker.getAttribute('cx'))).toBeLessThanOrEqual(100)

		minimap.update({ ...initial, runId: 2 }, [])
		expect(minimap.element.querySelector('[data-kind="player"]')).not.toBe(
			player,
		)
	})

	it('keeps world Y orientation, paints the player over rivals, and drops invalid stale poses', () => {
		const minimap = createRaceMinimap()
		const base = snapshot()
		const path = {
			...raceState(base).path,
			closed: false,
			points: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
			],
		}
		const state = {
			...base.state,
			path,
			vehicles: [
				{ id: 'player', player: true, x: 5, y: 10, finishedAt: null },
				{ id: 'rival', player: false, x: 5, y: 0, finishedAt: null },
			],
		}
		minimap.update({ ...base, state: state as never }, [])
		const svg = requiredElement(
			minimap.element.querySelector('svg'),
			'minimap SVG',
		)
		const player = requiredElement(
			svg.querySelector('[data-map-player]'),
			'player marker',
		)
		const rival = requiredElement(
			svg.querySelector('[data-kind="vehicle"]'),
			'rival marker',
		)
		expect(Number(player.getAttribute('cy'))).toBeGreaterThan(
			Number(rival.getAttribute('cy')),
		)
		expect(player.parentElement).toBe(svg.lastElementChild)
		expect(player.parentElement?.lastElementChild).toBe(player)

		minimap.update({ ...base, state: state as never }, [pose(8, 4)])
		expect(player.parentElement).toBe(svg.lastElementChild)
		expect(player.parentElement?.lastElementChild).toBe(player)

		minimap.update(
			{
				...base,
				state: {
					...state,
					vehicles: [{ ...state.vehicles[0], x: Number.NaN }],
				} as never,
			},
			[],
		)
		expect(minimap.element.querySelector('[data-map-player]')).toBeNull()
		expect(minimap.element.querySelector('[data-map-heading]')).toBeNull()
	})

	it('tracks the player heading in world radians and hides stale or invalid heading only', () => {
		const minimap = createRaceMinimap()
		const base = snapshot()
		const baseState = raceState(base)
		const path = {
			...baseState.path,
			closed: false,
			points: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
				{ x: 0, y: 10 },
			],
		}
		const player = { id: 'player', player: true, x: 5, y: 5, finishedAt: null }
		const updatePlayer = (angle: number | undefined) =>
			minimap.update(
				{
					...base,
					state: {
						...baseState,
						path,
						vehicles: [
							{ ...player, ...(angle === undefined ? {} : { angle }) },
						],
					} as never,
				},
				[],
			)

		updatePlayer(0)
		const marker = requiredElement(
			minimap.element.querySelector('[data-map-player]'),
			'player marker',
		)
		const heading = requiredElement(
			minimap.element.querySelector('[data-map-heading]'),
			'heading indicator',
		)
		const startX = Number(heading.getAttribute('x1'))
		const startY = Number(heading.getAttribute('y1'))
		const eastX = Number(heading.getAttribute('x2'))
		const eastY = Number(heading.getAttribute('y2'))
		expect(eastX).toBeGreaterThan(startX)
		expect(eastY).toBe(startY)

		updatePlayer(Math.PI / 2)
		expect(minimap.element.querySelector('[data-map-heading]')).toBe(heading)
		expect(Number(heading.getAttribute('x2'))).toBeCloseTo(startX)
		expect(Number(heading.getAttribute('y2'))).toBeGreaterThan(eastY)

		updatePlayer(Number.NaN)
		expect(heading.getAttribute('visibility')).toBe('hidden')
		expect(minimap.element.querySelector('[data-map-player]')).toBe(marker)
		updatePlayer(undefined)
		expect(heading.getAttribute('visibility')).toBe('hidden')

		minimap.update({ ...base, state: null }, [])
		expect(minimap.element.querySelector('[data-map-heading]')).toBeNull()
	})

	it('preserves open routes and hides the map without state', () => {
		const minimap = createRaceMinimap()
		const closed = snapshot()
		minimap.update(closed, [])
		expect(
			minimap.element
				.querySelector('[data-kind="route"]')
				?.getAttribute('d')
				?.endsWith('Z'),
		).toBe(true)

		const closedState = raceState(closed)
		const openPath = { ...closedState.path, closed: false }
		minimap.update(
			{ ...closed, state: { ...closedState, path: openPath } as never },
			[],
		)
		const route = minimap.element.querySelector('[data-kind="route"]')
		expect(route?.getAttribute('d')?.endsWith('Z')).toBe(false)

		minimap.update({ ...closed, state: null }, [])
		expect(minimap.element.querySelector('svg')).toBeNull()
		expect(minimap.element.hidden).toBe(true)
	})

	it('caps the static SVG route at 512 sampled points', () => {
		const minimap = createRaceMinimap()
		const base = snapshot()
		const points = Array.from({ length: 4096 }, (_, index) => ({
			x: index,
			y: index % 17,
		}))
		let indexedReads = 0
		const sampledSource = new Proxy(points, {
			get(target, key, receiver) {
				if (typeof key === 'string' && /^\d+$/.test(key)) indexedReads += 1
				return Reflect.get(target, key, receiver)
			},
		})
		const baseState = raceState(base)
		const path = { ...baseState.path, points: sampledSource, closed: false }
		minimap.update(
			{ ...base, state: { ...baseState, path, vehicles: [] } as never },
			[],
		)
		const route = minimap.element.querySelector('[data-kind="route"]')
		expect(route?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(512)
		expect(indexedReads).toBe(512)
	})

	it('has an accessible label and handles degenerate or non-finite path coordinates', () => {
		const minimap = createRaceMinimap()
		const base = snapshot()
		const baseState = raceState(base)
		const path = {
			...baseState.path,
			closed: true,
			points: [
				{ x: 3, y: 3 },
				{ x: 3, y: 3 },
				{ x: Number.NaN, y: 0 },
			],
		}
		minimap.update(
			{ ...base, state: { ...baseState, path, vehicles: [] } as never },
			[],
		)
		expect(
			minimap.element.querySelector('svg')?.getAttribute('aria-label'),
		).toBe('Race minimap')
		expect(
			minimap.element.querySelector('[data-kind="route"]')?.getAttribute('d'),
		).toMatch(/^M[\d.-]+,[\d.-]+/)
		expect(minimap.element.querySelector('[data-kind="player"]')).toBeNull()
	})
})
