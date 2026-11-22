import type { CarId } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'

/**
 * Minimal grounded player for isolated car-physics contracts.
 * Do not use createRace here: AI rosters, grids and race setup are tested
 * separately and must not affect braking, steering or surface behavior.
 */
export function physicsPlayer(car: CarId): RaceVehicle {
  return {
    id: 'player',
    car,
    player: true,
    x: 0,
    y: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    yawRate: 0,
    speed: 0,
    slip: 0,
    braking: false,
    lane: 0,
    ai: null,
    aiPace: 1,
    pathIndex: 0,
    pathDistance: 0,
    z: 0,
    verticalVelocity: 0,
    grounded: true,
    suspensionCompression: 0,
    landingIntensity: 0,
    contactLoad: 1,
    structureRunId: null,
    nextSector: 1,
    lap: 0,
    damage: 0,
    damageLimit: 5,
    damageCooldown: 0,
    wrecked: false,
    currentSurface: 'street',
    surfaceGrip: 1,
    onCurb: false,
    stuckDuration: 0,
    finishedAt: null,
  }
}
