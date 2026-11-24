import { CAR_IDS, type CarId, type SurfaceId } from '@/domain/model'
import type { DriverInput, RaceVehicle } from '@/domain/race/raceState'
import type { VehicleStepContext } from '@/domain/race/trackContext'
import { stepVehicle } from '@/domain/race/vehiclePhysics'

const DT = 1 / 60
const SURFACES = ['street', 'dirt', 'ice'] as const satisfies readonly SurfaceId[]

export interface PlayerBalanceProbe {
  readonly car: CarId
  readonly surface: typeof SURFACES[number]
  /** Full throttle from rest, in world units and units per second. */
  readonly acceleration: { readonly distanceAt1_5s: number; readonly distanceAt8s: number; readonly speedAt8s: number }
  /** Full player brake from 170 units/s, including brake pressure buildup. */
  readonly braking: { readonly distance: number; readonly seconds: number; readonly stopped: boolean }
  /** Fixed 0.65 steering from 135 units/s; no throttle or brake for 50 ticks. */
  readonly cornering: { readonly forwardDistance: number; readonly lateralDistance: number; readonly finalSpeed: number; readonly yawRate: number; readonly meanSlipAngle: number }
}

function context(surface: typeof SURFACES[number]): VehicleStepContext {
  return {
    nearest: { index: 0, point: { x: 0, y: 0, surface, distance: 0, segment: 0, sectionId: 'probe', structure: 'surface' }, distance: 0 },
    onRoad: true, onCurb: false, surface,
    tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 },
    surfaceHeight: 0, grade: 0, structureRunId: null,
    terrainMaterial: 'grass', safeAboveWater: false,
  }
}

function player(car: CarId, surface: typeof SURFACES[number], speed = 0): RaceVehicle {
  return {
    id: 'player', car, player: true, x: 0, y: 0, angle: 0,
    vx: speed, vy: 0, yawRate: 0, speed, slip: 0, braking: false,
    lane: 0, ai: null, aiPace: 1, pathIndex: 0, pathDistance: 0,
    z: 0, verticalVelocity: 0, grounded: true, suspensionCompression: 0,
    landingIntensity: 0, contactLoad: 1, structureRunId: null,
    nextSector: 1, lap: 0, currentSurface: surface,
    onCurb: false, stuckDuration: 0, finishedAt: null,
  }
}

/** Controlled open-plane characterization; this does not model a track or race. */
export function runPlayerBalanceProbe(car: CarId, surface: typeof SURFACES[number]): PlayerBalanceProbe {
  const road = context(surface)
  const throttle: DriverInput = { steering: 0, throttle: 1, braking: false }
  let vehicle = player(car, surface)
  let distanceAt1_5s = 0
  for (let frame = 1; frame <= 480; frame += 1) {
    vehicle = stepVehicle(vehicle, throttle, road, DT)
    if (frame === 90) distanceAt1_5s = vehicle.x
  }
  const acceleration = { distanceAt1_5s, distanceAt8s: vehicle.x, speedAt8s: vehicle.speed }

  vehicle = player(car, surface, 170)
  const brake: DriverInput = { steering: 0, throttle: 0, braking: true }
  let frames = 0
  while (frames < 720 && vehicle.speed > 0.5) {
    vehicle = stepVehicle(vehicle, brake, road, DT)
    frames += 1
  }
  const braking = { distance: vehicle.x, seconds: frames * DT, stopped: vehicle.speed <= 0.5 }

  vehicle = player(car, surface, 135)
  const steer: DriverInput = { steering: 0.65, throttle: 0, braking: false }
  let slipAngleSum = 0
  for (let frame = 0; frame < 50; frame += 1) {
    vehicle = stepVehicle(vehicle, steer, road, DT)
    if (frame >= 10) slipAngleSum += Math.asin(Math.min(1, vehicle.slip / Math.max(1, vehicle.speed)))
  }
  const cornering = {
    forwardDistance: vehicle.x, lateralDistance: vehicle.y, finalSpeed: vehicle.speed,
    yawRate: vehicle.yawRate, meanSlipAngle: slipAngleSum / 40,
  }
  return { car, surface, acceleration, braking, cornering }
}

/** All four player cars and the three road surfaces, in stable order. */
export function runPlayerBalanceMatrix(): readonly PlayerBalanceProbe[] {
  return SURFACES.flatMap(surface => CAR_IDS.map(car => runPlayerBalanceProbe(car, surface)))
}
