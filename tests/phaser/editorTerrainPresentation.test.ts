import type Phaser from 'phaser'
import { describe, expect, it, vi } from 'vitest'
import type { AppSnapshot } from '@/application/appState'
import { createEditorState } from '@/domain/editor/editorState'
import type { TerrainMap, TrackPoint } from '@/domain/model'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import type { EditorRenderState } from '@/phaser/rendering/editorRenderInvalidation'
import { EditorTerrainPresentation } from '@/phaser/rendering/editorTerrainPresentation'
import * as bitmapLayers from '@/presentation/environments/meadowBitmapTiles'

const terrain: TerrainMap = {
	cellSize: 32,
	cells: [
		{ column: 0, row: 0, kind: 'water' },
		...Array.from({ length: 256 }, (_, index) => ({
			column: 5 + (index % 16),
			row: 5 + Math.floor(index / 16),
			kind: 'hill' as const,
		})),
	],
}

const view = {
	centerX: 0,
	centerY: 0,
	width: 400,
	height: 300,
	zoom: 1,
	rotation: 0,
}

function snapshotFor(points: readonly TrackPoint[]): AppSnapshot {
	const editor = createEditorState(points, [], undefined, terrain)
	return {
		mode: 'editor',
		paused: false,
		overlay: { type: 'none' },
		tracks: [],
		currentTrack: null,
		editor,
		editorUi: {
			tool: 'draw',
			surface: 'street',
			structure: 'overpass',
			terrainBrush: { mode: 'raise', radius: 48 },
			grid: true,
			cameraRequest: null,
			selectedCrossing: null,
			selectedPoint: null,
		},
		preferences: {} as AppSnapshot['preferences'],
		scoresByTrack: {},
		notice: null,
	}
}

function renderState(snapshot: AppSnapshot): EditorRenderState {
	return {
		routeKind: snapshot.editor.routeKind,
		points: snapshot.editor.points,
		terrain: snapshot.editor.terrain,
		trees: snapshot.editor.trees,
		scenery: snapshot.editor.scenery,
		environmentId: snapshot.editor.environmentId,
		start: snapshot.editor.start,
		night: false,
		grid: true,
		selectedPoint: null,
		selectedCrossing: null,
		tool: 'draw',
		terrainMode: 'raise',
		terrainRadius: 48,
	}
}

function bitmapSource(visible: boolean) {
	return {
		visible: () => (visible ? [{ x: 0, y: 0, variant: 0 }] : []),
		image: vi.fn(() => ({}) as HTMLCanvasElement),
		all: () => [],
		bake: () => ({}) as HTMLCanvasElement,
	}
}

function sceneFixture() {
	const listeners = new Map<string, () => void>()
	const removed = vi.fn()
	const addCanvas = vi.fn(() => ({}))
	const image = () => {
		const item = {
			visible: true,
			setOrigin: () => item,
			setDepth: () => item,
			setVisible: (visible: boolean) => {
				item.visible = visible
				return item
			},
			destroy: vi.fn(),
		}
		return item
	}
	const scene = {
		game: {
			loop: { rawDelta: 1000 / 60 },
			events: {
				on: (name: string, callback: () => void) =>
					listeners.set(name, callback),
				off: (name: string, callback: () => void) => {
					if (listeners.get(name) === callback) listeners.delete(name)
				},
			},
		},
		events: { once: vi.fn(), off: vi.fn() },
		textures: { addCanvas, remove: removed },
		add: { image },
	} as unknown as Phaser.Scene
	const frames = () => {
		listeners.get('prestep')?.()
		listeners.get('postrender')?.()
		listeners.get('prestep')?.()
		listeners.get('postrender')?.()
	}
	return { scene, frames, addCanvas, removed, listeners }
}

function terrainGraphics() {
	const renders: number[] = []
	let currentTriangles = 0
	const graphics = new Proxy(
		{},
		{
			get(_target, property) {
				if (property === 'clear')
					return () => {
						if (currentTriangles > 0) renders.push(currentTriangles)
						currentTriangles = 0
						return graphics
					}
				if (property === 'fillTriangle')
					return () => {
						currentTriangles += 1
					}
				return () => graphics
			},
		},
	) as Phaser.GameObjects.Graphics
	return {
		graphics,
		renders,
		currentCount: () => currentTriangles,
		flush: () => renders.push(currentTriangles),
	}
}

describe('EditorTerrainPresentation lifecycle', () => {
	it('retains water through road edits, changes detail with zoom, and releases textures at shutdown', () => {
		const { scene, frames, addCanvas, removed, listeners } = sceneFixture()
		const graphics = terrainGraphics()
		const water = bitmapSource(true)
		const empty = bitmapSource(false)
		const hill = bitmapSource(false)
		const createWater = vi
			.spyOn(bitmapLayers, 'createEditorWaterBitmapTiles')
			.mockReturnValue(water)
		const createHill = vi
			.spyOn(bitmapLayers, 'createEditorHillBitmapTiles')
			.mockReturnValue(hill)
		const createRoad = vi
			.spyOn(bitmapLayers, 'createEditorRoadBitmapLayers')
			.mockReturnValue({
				road: empty,
				bridgeApproach: undefined,
				bridgeDeck: undefined,
			})
		const firstPoints: TrackPoint[] = [
			{ x: -200, y: -1_000, surface: 'street' },
			{ x: 400, y: -1_000, surface: 'street' },
		]
		const secondPoints = firstPoints.map((point) => ({
			...point,
			y: point.y + 100,
		}))
		const first = snapshotFor(firstPoints)
		const second = snapshotFor(secondPoints)
		const firstGeometry = buildTrackGeometry({
			routeKind: first.editor.routeKind,
			points: firstPoints,
			terrain,
		})
		const secondGeometry = buildTrackGeometry({
			routeKind: second.editor.routeKind,
			points: secondPoints,
			terrain,
		})
		const presentation = new EditorTerrainPresentation(
			scene,
			graphics.graphics,
			20,
		)
		let recreated: EditorTerrainPresentation | undefined
		try {
			presentation.renderWorld(firstGeometry, first, renderState(first), 0.5)
			presentation.renderBitmap(view)
			frames()
			const fullDetailTriangles = graphics.currentCount()
			expect(fullDetailTriangles).toBeGreaterThan(0)
			expect(createWater).toHaveBeenCalledTimes(1)
			expect(water.image).toHaveBeenCalledTimes(1)
			expect(addCanvas).toHaveBeenCalledTimes(1)

			presentation.renderWorld(secondGeometry, second, renderState(second), 0.5)
			presentation.renderBitmap(view)
			frames()
			expect(graphics.currentCount()).toBe(fullDetailTriangles)
			expect(createWater).toHaveBeenCalledTimes(1)
			expect(water.image).toHaveBeenCalledTimes(1)
			expect(addCanvas).toHaveBeenCalledTimes(1)
			expect(removed).not.toHaveBeenCalled()

			presentation.refreshForCamera(
				secondGeometry,
				second,
				renderState(second),
				0.2,
			)
			graphics.flush()
			const [fullCount, overviewCount] = graphics.renders
			if (fullCount === undefined || overviewCount === undefined) {
				throw new Error('Expected full and overview terrain renders')
			}
			expect(overviewCount).toBeLessThan(fullCount)
			expect(createHill).toHaveBeenCalledTimes(1)
			expect(addCanvas).toHaveBeenCalledTimes(1)

			presentation.destroy()
			expect(removed).toHaveBeenCalledTimes(1)
			expect(listeners.size).toBe(0)

			recreated = new EditorTerrainPresentation(scene, graphics.graphics, 20)
			recreated.renderWorld(secondGeometry, second, renderState(second), 0.5)
			recreated.renderBitmap(view)
			frames()
			expect(createWater).toHaveBeenCalledTimes(2)
			expect(addCanvas).toHaveBeenCalledTimes(2)
			recreated.destroy()
			expect(removed).toHaveBeenCalledTimes(2)
		} finally {
			presentation.destroy()
			recreated?.destroy()
			createWater.mockRestore()
			createHill.mockRestore()
			createRoad.mockRestore()
		}
	})
})
