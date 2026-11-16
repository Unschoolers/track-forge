import type { RacePhase, RaceState, RaceVehicle } from '@/domain/race/raceState'

export type RaceVehicleSnapshot = Pick<
  RaceVehicle,
  | 'id'
  | 'car'
  | 'player'
  | 'x'
  | 'y'
  | 'z'
  | 'angle'
  | 'vx'
  | 'vy'
  | 'speed'
  | 'grounded'
  | 'pathIndex'
  | 'structureRunId'
  | 'braking'
  | 'wrecked'
  | 'damage'
  | 'lap'
  | 'nextSector'
  | 'finishedAt'
>

export interface RaceTickSnapshot {
  readonly tick: number
  readonly elapsed: number
  readonly phase: RacePhase
  readonly countdown: number
  readonly paused: boolean
  readonly totalLaps: number
  readonly vehicles: readonly RaceVehicleSnapshot[]
}

/** Captures vehicle presentation and race progress for consumers with the same track geometry. */
export function captureRaceSnapshot(state: RaceState): RaceTickSnapshot {
  return {
    tick: state.tick,
    elapsed: state.elapsed,
    phase: state.phase,
    countdown: state.countdown,
    paused: state.paused,
    totalLaps: state.totalLaps,
    vehicles: state.vehicles.map((vehicle) => ({
      id: vehicle.id,
      car: vehicle.car,
      player: vehicle.player,
      x: vehicle.x,
      y: vehicle.y,
      z: vehicle.z,
      angle: vehicle.angle,
      vx: vehicle.vx,
      vy: vehicle.vy,
      speed: vehicle.speed,
      grounded: vehicle.grounded,
      pathIndex: vehicle.pathIndex,
      structureRunId: vehicle.structureRunId,
      braking: vehicle.braking,
      wrecked: vehicle.wrecked,
      damage: vehicle.damage,
      lap: vehicle.lap,
      nextSector: vehicle.nextSector,
      finishedAt: vehicle.finishedAt,
    })),
  }
}
