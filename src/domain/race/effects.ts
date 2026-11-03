import type { RandomSource } from '@/application/ports/random'
import type { Vector2 } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'

export type RaceParticleKind =
  | 'dirt'
  | 'grass'
  | 'ice'
  | 'tire-smoke'
  | 'spark'
  | 'damage-smoke'
  | 'speed-line'

export interface RaceParticle extends Vector2 {
  readonly kind: RaceParticleKind
  readonly vx: number
  readonly vy: number
  readonly life: number
  readonly maxLife: number
  readonly size: number
}

export interface SkidMark {
  readonly start: Vector2
  readonly end: Vector2
  readonly life: number
  readonly maxLife: number
  readonly width: number
}

export interface RaceEffectsState {
  readonly particles: readonly RaceParticle[]
  readonly skids: readonly SkidMark[]
  readonly previousTires: Readonly<Record<string, Vector2>>
}

export interface RaceEffectEvent {
  readonly type: string
  readonly leftId?: string
  readonly rightId?: string
  readonly strength?: number
}

const MAX_PARTICLES = 180
const MAX_SKIDS = 120

export function createRaceEffectsState(): RaceEffectsState {
  return { particles: [], skids: [], previousTires: {} }
}

function particle(
  kind: RaceParticleKind,
  vehicle: RaceVehicle,
  random: RandomSource,
  life: number,
  size: number,
): RaceParticle {
  return {
    kind,
    x: vehicle.x - Math.cos(vehicle.angle) * 12,
    y: vehicle.y - Math.sin(vehicle.angle) * 12,
    vx: -vehicle.vx * 0.1 + (random.next() - 0.5) * 24,
    vy: -vehicle.vy * 0.1 + (random.next() - 0.5) * 24,
    life,
    maxLife: life,
    size,
  }
}

export function advanceRaceEffects(
  state: RaceEffectsState,
  vehicles: readonly RaceVehicle[],
  events: readonly RaceEffectEvent[],
  deltaSeconds: number,
  random: RandomSource,
): RaceEffectsState {
  const dt = Math.max(0, deltaSeconds)
  const particles: RaceParticle[] = state.particles
    .map((item) => ({
      ...item,
      x: item.x + item.vx * dt,
      y: item.y + item.vy * dt,
      life: item.life - dt,
    }))
    .filter(({ life }) => life > 0)
  const skids: SkidMark[] = state.skids
    .map((item) => ({ ...item, life: item.life - dt }))
    .filter(({ life }) => life > 0)
  const previousTires: Record<string, Vector2> = {
    ...state.previousTires,
  }

  for (const vehicle of vehicles) {
    if (
      vehicle.speed > 50 &&
      (vehicle.currentSurface === 'dirt' ||
        vehicle.currentSurface === 'grass') &&
      random.next() < 0.62
    ) {
      particles.push(
        particle(
          vehicle.currentSurface,
          vehicle,
          random,
          vehicle.currentSurface === 'grass' ? 0.48 : 0.62,
          vehicle.currentSurface === 'grass' ? 3 : 4,
        ),
      )
    }
    if (
      vehicle.currentSurface === 'ice' &&
      vehicle.speed > 65 &&
      (vehicle.braking || vehicle.slip > 14) &&
      random.next() < 0.55
    ) {
      particles.push(particle('ice', vehicle, random, 0.42, 3))
    }
    if (vehicle.braking && vehicle.speed > 70) {
      particles.push(particle('tire-smoke', vehicle, random, 0.38, 3.5))
    }
    if (
      vehicle.player &&
      vehicle.damage / Math.max(1, vehicle.damageLimit) >= 0.5 &&
      random.next() < 0.35
    ) {
      particles.push(particle('damage-smoke', vehicle, random, 0.9, 5))
    }
    if (
      vehicle.player &&
      vehicle.speed > 215 &&
      random.next() < 0.45
    ) {
      particles.push(particle('speed-line', vehicle, random, 0.22, 1.2))
    }
    const skidThreshold =
      vehicle.currentSurface === 'ice'
        ? 17
        : vehicle.currentSurface === 'dirt'
          ? 30
          : 42
    const tire = {
      x: vehicle.x - Math.cos(vehicle.angle) * 10,
      y: vehicle.y - Math.sin(vehicle.angle) * 10,
    }
    const previous = previousTires[vehicle.id] ?? {
      x: tire.x - vehicle.vx * dt,
      y: tire.y - vehicle.vy * dt,
    }
    if (
      previous &&
      vehicle.speed > 58 &&
      vehicle.currentSurface !== 'grass' &&
      (vehicle.braking || vehicle.slip > skidThreshold)
    ) {
      skids.push({
        start: previous,
        end: tire,
        life: 2.2,
        maxLife: 2.2,
        width: vehicle.currentSurface === 'ice' ? 1 : 1.8,
      })
    }
    previousTires[vehicle.id] = tire
  }

  for (const event of events) {
    if (event.type !== 'collision') continue
    const involved = vehicles.find(
      ({ id }) => id === event.leftId || id === event.rightId,
    )
    if (!involved) continue
    const count = Math.max(3, Math.min(10, Math.round((event.strength ?? 0) / 12)))
    for (let index = 0; index < count; index += 1) {
      particles.push(particle('spark', involved, random, 0.35, 2.2))
    }
  }

  return {
    particles: particles.slice(-MAX_PARTICLES),
    skids: skids.slice(-MAX_SKIDS),
    previousTires,
  }
}
