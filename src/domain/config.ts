import type {
  CarId,
  DifficultyId,
  SurfaceId,
  Vector2,
} from '@/domain/model'
import {
  CAR_PHYSICS_SPECS,
  SURFACE_PHYSICS_SPECS,
} from '@/domain/race/vehiclePhysicsConfig'
import type {
  CarPhysicsSpec,
  SurfacePhysicsSpec,
  TerrainPhysicsModifier,
} from '@/domain/race/vehiclePhysicsConfig'

export {
  VEHICLE_TERRAIN_PHYSICS_SPECS as VEHICLE_TERRAIN_SPECS,
  VERTICAL_DYNAMICS,
} from '@/domain/race/vehiclePhysicsConfig'

export interface GridPosition {
  readonly lane: number
  readonly back: number
}

export interface RoadGeometry {
  readonly edgeWidth: number
  readonly surfaceWidth: number
  readonly onRoadRadius: number
  readonly curbInner: number
  readonly curbOuter: number
  readonly curbDetectInner: number
  readonly curbDetectOuter: number
  readonly bridgeRampLength: number
  readonly bridgeWallClearance: number
  readonly bridgePillarSpacing: number
  readonly centerGuard: number
  readonly maxLane: number
  readonly lanes: readonly number[]
  readonly startGrid: readonly GridPosition[]
  readonly aiBaseLanes: readonly number[]
}

export interface CarSpec extends CarPhysicsSpec {
  readonly color: string
  readonly name: string
  readonly role: string
  readonly description: string
  readonly uiSpeed: number
  readonly uiGrip: number
  readonly uiBrake: number
  readonly uiOffroad: number
}

export interface SurfaceSpec extends SurfacePhysicsSpec {
  readonly name: string
  readonly road: string
  readonly edge: string
  readonly stripe: string
  readonly nightRoad: string
  readonly nightEdge: string
  readonly nightStripe: string
}

export type TerrainModifier = TerrainPhysicsModifier

export interface DifficultySpec {
  readonly name: string
  readonly pace: number
  readonly reaction: number
  readonly brakeMargin: number
  readonly lineError: number
  readonly mistakeRate: number
  readonly cornerSafety: number
  readonly lookAhead: number
  readonly steerGain: number
  readonly damageLimit: number
  readonly avoidance: number
  readonly followDistance: number
  readonly description: string
  readonly mirrorRival?: boolean
  readonly aiPaces?: readonly number[]
}

export interface OvertakeSpec {
  readonly triggerDistance: number
  readonly emergencyTTC: number
  readonly emergencyDistance: number
  readonly passClearance: number
  readonly completionDistance: number
  readonly laneHold: number
}

export const TAU = Math.PI * 2
export const TRACK_CLOSE_DISTANCE = 74

/** Shared world-space measurements for terrain and raised road structures. */
export const WORLD_ELEVATION = {
  cellSize: 32,
  baseHeight: 0,
  levelHeight: 24,
  naturalSlopeRun: 24,
  roadSlopeRun: 96,
} as const

/** Limits applied before terrain data enters editor or persisted state. */
export const TERRAIN_LIMITS = {
  minimumCoordinate: -2048,
  maximumCoordinate: 2048,
  maximumCells: 20_000,
  brushRadii: [48, 96, 160],
} as const
export type TerrainBrushRadius = (typeof TERRAIN_LIMITS.brushRadii)[number]
export const DEFAULT_TERRAIN_BRUSH_RADIUS: TerrainBrushRadius =
  TERRAIN_LIMITS.brushRadii[0]

export const ROAD_GEOMETRY: RoadGeometry = {
  edgeWidth: 87,
  surfaceWidth: 72,
  onRoadRadius: 42,
  // Curbs are road furniture: keep the whole strip inside the 36-unit
  // asphalt radius instead of painting and detecting it in the verge.
  curbInner: 26.5,
  curbOuter: 36,
  curbDetectInner: 26.5,
  curbDetectOuter: 36,
  bridgeRampLength: 97.2,
  bridgeWallClearance: 0.18,
  bridgePillarSpacing: 115.2,
  centerGuard: 29,
  maxLane: 25,
  lanes: [-24, -8, 8, 24],
  startGrid: [
    { lane: -20, back: 0 },
    { lane: 20, back: 8 },
    { lane: -8, back: 38 },
    { lane: 8, back: 48 },
  ],
  aiBaseLanes: [0, 10, -10, 0],
}

export const CAR_SPECS = {
  blue: {
    ...CAR_PHYSICS_SPECS.blue,
    color: '#3a8cff',
    name: 'Blue',
    role: 'Balanced',
    description: 'Predictable on every surface with no major weakness.',
    uiSpeed: 3,
    uiGrip: 3,
    uiBrake: 3,
    uiOffroad: 3,
  },
  red: {
    ...CAR_PHYSICS_SPECS.red,
    color: '#ff4f4f',
    name: 'Red',
    role: 'Pavement specialist',
    description:
      'Fastest on clean street, but loses enormous speed and control in dirt or grass.',
    uiSpeed: 5,
    uiGrip: 2,
    uiBrake: 2,
    uiOffroad: 1,
  },
  green: {
    ...CAR_PHYSICS_SPECS.green,
    color: '#49d66f',
    name: 'Green',
    role: 'Corner specialist',
    description:
      'Excellent grip and recovery, including predictable handling on loose surfaces.',
    uiSpeed: 2,
    uiGrip: 5,
    uiBrake: 4,
    uiOffroad: 4,
  },
  yellow: {
    ...CAR_PHYSICS_SPECS.yellow,
    color: '#ffd43b',
    name: 'Yellow',
    role: 'Heavy off-road',
    description:
      'Slowest on street, but keeps far more momentum and stability through dirt and grass.',
    uiSpeed: 2,
    uiGrip: 4,
    uiBrake: 5,
    uiOffroad: 5,
  },
} as const satisfies Record<CarId, CarSpec>

export const SURFACE_SPECS = {
  street: {
    ...SURFACE_PHYSICS_SPECS.street,
    name: 'STREET',
    road: '#484e56',
    edge: '#d2d7dd',
    stripe: '#f1d65a',
    nightRoad: '#30363f',
    nightEdge: '#687480',
    nightStripe: '#e4d474',
  },
  dirt: {
    ...SURFACE_PHYSICS_SPECS.dirt,
    name: 'DIRT',
    road: '#95643a',
    edge: '#c49a68',
    stripe: '#d9c095',
    nightRoad: '#5d4028',
    nightEdge: '#8d6843',
    nightStripe: '#b69c74',
  },
  ice: {
    ...SURFACE_PHYSICS_SPECS.ice,
    name: 'ICE',
    road: '#9bcfe1',
    edge: '#d8f3fb',
    stripe: '#eefcff',
    nightRoad: '#4d8296',
    nightEdge: '#82b8ca',
    nightStripe: '#d8f5ff',
  },
} as const satisfies Record<SurfaceId, SurfaceSpec>

export const OFFROAD_SURFACE = {
  ...SURFACE_PHYSICS_SPECS.grass,
  name: 'GRASS',
} as const satisfies Pick<
  SurfaceSpec,
  'name' | 'max' | 'accel' | 'grip' | 'brake'
>

export const DIFFICULTY_SPECS = {
  easy: {
    name: 'Easy',
    pace: 0.9,
    reaction: 5.6,
    brakeMargin: 16,
    lineError: 5.5,
    mistakeRate: 0.021,
    cornerSafety: 1.12,
    lookAhead: 2,
    steerGain: 1.62,
    damageLimit: 10,
    avoidance: 1,
    followDistance: 34,
    description:
      'Competitive but forgiving opponents. Your vehicle can survive 10 distinct impacts.',
  },
  normal: {
    name: 'Medium',
    pace: 0.965,
    reaction: 7.6,
    brakeMargin: 7,
    lineError: 2.8,
    mistakeRate: 0.007,
    cornerSafety: 1.035,
    lookAhead: 0,
    steerGain: 1.76,
    damageLimit: 5,
    avoidance: 1.12,
    followDistance: 39,
    description:
      'Fast, accurate opponents. Your vehicle can survive 5 distinct impacts.',
  },
  hard: {
    name: 'Hard',
    pace: 1.03,
    reaction: 12,
    brakeMargin: -6,
    lineError: 0.18,
    mistakeRate: 0,
    cornerSafety: 0.74,
    lookAhead: -2,
    steerGain: 2.05,
    damageLimit: 3,
    avoidance: 1.3,
    followDistance: 42,
    mirrorRival: true,
    aiPaces: [1.012, 1.006, 1],
    description:
      'A mirror rival uses your own car, with near-perfect lines and very late braking. Only 3 impacts will wreck you.',
  },
} as const satisfies Record<DifficultyId, DifficultySpec>

export const AI_OVERTAKE = {
  easy: {
    triggerDistance: 68,
    emergencyTTC: 0.3,
    emergencyDistance: 8.5,
    passClearance: 17,
    completionDistance: 25,
    laneHold: 0.75,
  },
  normal: {
    triggerDistance: 80,
    emergencyTTC: 0.23,
    emergencyDistance: 7.5,
    passClearance: 16,
    completionDistance: 28,
    laneHold: 0.85,
  },
  hard: {
    triggerDistance: 96,
    emergencyTTC: 0.16,
    emergencyDistance: 6.5,
    passClearance: 15,
    completionDistance: 31,
    laneHold: 1,
  },
} as const satisfies Record<DifficultyId, OvertakeSpec>

export const STARTER_TREES: readonly Vector2[] = [
  { x: -245, y: -185 },
  { x: 230, y: -165 },
  { x: -255, y: 145 },
  { x: 250, y: 190 },
  { x: -30, y: -20 },
  { x: 42, y: 55 },
  { x: 5, y: 105 },
]
