import type { TerrainPresentationDetail } from '@/phaser/rendering/terrainMesh'

/**
 * Large authored landscapes cost thousands of triangles even at driving zoom.
 * Prefer a coarser *rendering* mesh there, or when the editor is zoomed out.
 * Neither mode changes terrain hit tests, physics, road geometry, or track data.
 */
export function terrainDetailForView(
  authoredCellCount: number | undefined,
  cameraZoom: number,
): TerrainPresentationDetail {
  return cameraZoom < 0.32 || (authoredCellCount ?? 0) >= 1_600
    ? 'overview'
    : 'full'
}
