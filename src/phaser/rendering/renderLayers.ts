/**
 * Shared Phaser depths for the world presentation stack. Lower vehicles are
 * intentionally interleaved with solid structures so underpass traffic stays
 * below decks while absolute-height vehicles render above walls.
 */
export const WORLD_RENDER_DEPTH = {
  editorGrid: -30,
  terrain: -20,
  scenery: -10,
  road: 0,
  structureUnderlay: 2,
  vehicleShadow: 4,
  lowerVehicle: 5,
  structureDeck: 10,
  structureWall: 12,
  upperVehicle: 15,
  lamp: 22,
  terrainPreview: 24,
  effect: 25,
  editorOverlay: 30,
  nightShade: 50,
  nightLight: 51,
} as const
