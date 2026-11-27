import type Phaser from 'phaser'
import type { AppSnapshot } from '@/application/appState'
import type { TrackGeometry } from '@/domain/track/trackGeometry'
import type { EditorCamera } from '@/phaser/input/editorInput'
import {
	type EditorRenderState,
	editorTerrainRenderRequired,
	hillRoadInfluenceKey,
} from '@/phaser/rendering/editorRenderInvalidation'
import { EditorWorldRaster } from '@/phaser/rendering/editorWorldRaster'
import {
	createMeadowBitmapRenderer,
	type EditorMeadowBitmapRenderer,
} from '@/phaser/rendering/meadowBitmapRenderer'
import { terrainDetailForView } from '@/phaser/rendering/terrainDetail'
import {
	RegionalTerrainMeshCache,
	type TerrainPresentationDetail,
} from '@/phaser/rendering/terrainMesh'
import { renderTerrain } from '@/phaser/rendering/terrainRenderer'
import { getTrackEnvironment } from '@/presentation/environments'

/** Owns editor terrain compilation and scene-lifetime bitmap resources.
 * The scene decides when snapshot and camera changes arrive. */
export class EditorTerrainPresentation {
	private readonly meshCache = new RegionalTerrainMeshCache()
	private readonly raster: EditorWorldRaster
	private readonly bitmap: EditorMeadowBitmapRenderer
	private renderedDetail: TerrainPresentationDetail | undefined
	private renderedHillInfluence = ''
	private renderedState: EditorRenderState | undefined

	constructor(
		scene: Phaser.Scene,
		private readonly graphics: Phaser.GameObjects.Graphics,
		depth: number,
	) {
		this.raster = new EditorWorldRaster(scene, [graphics], depth)
		this.bitmap = createMeadowBitmapRenderer(
			scene,
			'local-ground',
			undefined,
			this.meshCache,
		)
	}

	renderWorld(
		geometry: TrackGeometry,
		snapshot: AppSnapshot,
		state: EditorRenderState,
		zoom: number,
	): void {
		const night = snapshot.currentTrack?.lighting === 'night'
		const hillInfluence = hillRoadInfluenceKey(
			snapshot.editor.terrain,
			geometry.path,
		)
		this.bitmap.update(
			geometry,
			snapshot.editor.terrain,
			hillInfluence,
			Boolean(snapshot.editor.gestureStart),
			night,
			snapshot.editor.environmentId,
		)
		const detail = terrainDetailForView(
			geometry.path.terrainSurface.authoredCellCount,
			zoom,
		)
		if (
			!editorTerrainRenderRequired(
				this.renderedState,
				state,
				detail !== this.renderedDetail,
				hillInfluence !== this.renderedHillInfluence,
			)
		)
			return
		this.renderTerrain(geometry, snapshot, state, detail, hillInfluence)
	}

	refreshForCamera(
		geometry: TrackGeometry,
		snapshot: AppSnapshot,
		state: EditorRenderState,
		zoom: number,
	): void {
		const detail = terrainDetailForView(
			geometry.path.terrainSurface.authoredCellCount,
			zoom,
		)
		if (detail === this.renderedDetail) return
		this.renderTerrain(geometry, snapshot, state, detail)
	}

	private renderTerrain(
		geometry: TrackGeometry,
		snapshot: AppSnapshot,
		state: EditorRenderState,
		detail: TerrainPresentationDetail,
		hillInfluence?: string,
	): void {
		const environment = getTrackEnvironment(snapshot.editor.environmentId)
		const night = snapshot.currentTrack?.lighting === 'night'
		this.graphics.clear()
		renderTerrain(
			this.graphics,
			geometry.path.terrainSurface,
			night,
			detail,
			night ? environment.night : environment.day,
			this.meshCache,
		)
		this.renderedDetail = detail
		this.renderedState = state
		this.renderedHillInfluence =
			hillInfluence ??
			hillRoadInfluenceKey(snapshot.editor.terrain, geometry.path)
		this.raster.invalidate()
	}

	renderRaster(
		camera: EditorCamera,
		width: number,
		height: number,
		enabled: boolean,
	): void {
		this.raster.render(camera, width, height, enabled)
	}

	renderBitmap(
		view: Parameters<EditorMeadowBitmapRenderer['render']>[0],
	): void {
		this.bitmap.render(view)
	}

	hasRoadLayers(): boolean {
		return this.bitmap.hasRoadLayers()
	}

	invalidateRaster(): void {
		this.raster.invalidate()
	}

	destroy(): void {
		this.bitmap.destroy()
		this.meshCache.clear()
	}
}
