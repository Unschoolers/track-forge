/**
 * Shared Phaser depths for the world presentation stack. Lower vehicles are
 * intentionally interleaved with solid structures so underpass traffic stays
 * below decks while absolute-height vehicles render above walls.
 */
export const WORLD_RENDER_DEPTH = {
  ground: -40,
  editorGrid: -30,
  terrain: -20,
  road: 0,
  // Above road bitmap and markings (+0.2/+0.4), below raised structures and cars.
  environmentScenery: 1,
  scenery: 1.5,
  structureUnderlay: 2,
  vehicleShadow: 4,
  lowerVehicle: 5,
  tallScenery: 8,
  structureDeck: 10,
  structureWall: 12,
  upperVehicle: 15,
  lamp: 22,
  terrainPreview: 24,
  effect: 25,
  editorOverlay: 30,
  nightBeam: 50,
  nightLight: 51,
} as const
