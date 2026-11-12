import type { CarId, Track } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'

export interface GhostSetup {
  readonly car: CarId
  readonly laps: number
  readonly handling?: 'arcade' | 'simulation'
}
export interface GhostFrame {
  readonly t: number
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly z: number
  readonly structureRunId: string | null
  /** This pose starts after a recovery; never interpolate into it. */
  readonly cut?: boolean
}
export interface GhostRun {
  readonly car: CarId
  readonly time: number
  readonly frames: readonly GhostFrame[]
  readonly splits?: readonly number[]
}
export interface GhostPose extends GhostFrame {
  readonly car: CarId
}
export interface GhostStore {
  load(track: Track, setup: GhostSetup): GhostRun | null
  record(track: Track, setup: GhostSetup, time: number, frames: readonly GhostFrame[], splits?: readonly number[]): boolean
}

export const MAX_GHOST_FRAMES = 3000 // Long Arcade runs compact older samples.

/** Track edits and a changed race setup must never reuse a stale ghost. */
export function ghostRaceKey(track: Track, setup: GhostSetup): string {
  return [
    track.id, track.updatedAt, track.start?.ratio ?? 0,
    track.start?.reversed ? 'reverse' : 'forward',
    setup.car, setup.laps, setup.handling ?? 'arcade',
  ].join('|')
}

export function captureGhost(vehicle: RaceVehicle, t: number): GhostFrame {
  return {
    t, x: vehicle.x, y: vehicle.y, angle: vehicle.angle,
    z: vehicle.z, structureRunId: vehicle.structureRunId,
  }
}

export function ghostPoseAt(run: GhostRun, time: number): GhostPose | null {
  const frames = run.frames
  if (!frames.length || !Number.isFinite(time) || time < 0 || time > run.time) return null
  const first = frames[0]
  if (!first) return null
  if (time <= first.t) return { ...first, car: run.car }
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if ((frames[mid]?.t ?? Infinity) < time) low = mid + 1
    else high = mid
  }
  const next = frames[low]
  const previous = frames[Math.max(0, low - 1)]
  if (!next || !previous) return { ...first, car: run.car }
  if (next.cut && time < next.t) return { ...previous, t: time, car: run.car }
  const fraction = Math.max(0, Math.min(1,
    (time - previous.t) / Math.max(0.000001, next.t - previous.t)))
  const lerp = (a: number, b: number): number => a + (b - a) * fraction
  const turn = Math.atan2(Math.sin(next.angle - previous.angle), Math.cos(next.angle - previous.angle))
  return {
    car: run.car,
    t: time,
    x: lerp(previous.x, next.x),
    y: lerp(previous.y, next.y),
    z: lerp(previous.z, next.z),
    angle: previous.angle + turn * fraction,
    structureRunId: fraction < 0.5 ? previous.structureRunId : next.structureRunId,
  }
}
