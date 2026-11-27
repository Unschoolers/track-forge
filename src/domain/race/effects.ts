import type { RandomSource } from '@/domain/race/randomSource'
import type { Vector2 } from '@/domain/model'
import type { RaceVehicle } from '@/domain/race/raceState'

export type RaceParticleKind =
  | 'dirt'
  | 'grass'
  | 'ice'
  | 'tire-smoke'
  | 'speed-line'
  | 'landing-dust'
  | 'water'

export interface RaceParticle extends Vector2 {
  readonly kind: RaceParticleKind
  /** Stable identity across simulation snapshots for native visual emitters. */
  readonly emissionId?: number
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
  readonly previousTires: Readonly<Record<string, readonly [Vector2, Vector2]>>
  readonly nextEmissionId?: number
}

export interface RaceEffectEvent {
  readonly type: string
  readonly vehicleId?: string
  readonly strength?: number
  readonly reason?: string
  readonly x?: number
  readonly y?: number
}

const MAX_PARTICLES = 180
// Keep the previous history budget per tire, now with two rear contact tracks.
const MAX_SKIDS = 240
const EFFECT_SIZE = {
  blue: { dust: 0.92, smoke: 0.8, speed: 1, skid: 0.9, landing: 0.95 },
  red: { dust: 0.96, smoke: 1, speed: 1.3, skid: 1, landing: 0.9 },
  green: { dust: 1, smoke: 1.35, speed: 1, skid: 1.12, landing: 1 },
  yellow: { dust: 1.35, smoke: 1.04, speed: 1, skid: 1.1, landing: 1.3 },
} as const

export function createRaceEffectsState(): RaceEffectsState {
  return { particles: [], skids: [], previousTires: {} }
}

function rearTirePoint(vehicle: RaceVehicle, side: number): Vector2 {
  const cosine = Math.cos(vehicle.angle)
  const sine = Math.sin(vehicle.angle)
  return { x: vehicle.x - cosine * 10 - sine * side * 7, y: vehicle.y - sine * 10 + cosine * side * 7 }
}

function particle(
  kind: RaceParticleKind,
  vehicle: RaceVehicle,
  random: RandomSource,
  life: number,
  size: number,
): RaceParticle {
  const a = random.next()
  const b = random.next()
  const side = a < 0.5 ? -1 : 1
  const cosine = Math.cos(vehicle.angle)
  const sine = Math.sin(vehicle.angle)
  const wind = kind === 'speed-line'
  const lateral = side * (15 + b * 10)
  const contact = rearTirePoint(vehicle, side)
  const spray = wind ? 0 : Math.min(22, 5 + vehicle.speed * 0.035 + vehicle.slip * 0.12) * side
  return {
    kind,
    x: wind ? vehicle.x - cosine * 2 - sine * lateral : contact.x,
    y: wind ? vehicle.y - sine * 2 + cosine * lateral : contact.y,
    vx: -vehicle.vx * (wind ? 0.32 : 0.14) - sine * spray + (wind ? 0 : (a - 0.5) * 12),
    vy: -vehicle.vy * (wind ? 0.32 : 0.14) + cosine * spray + (wind ? 0 : (b - 0.5) * 12),
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
  tick = 0,
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
  const previousTires: Record<string, readonly [Vector2, Vector2]> = {}

  for (const vehicle of vehicles) {
    const size = EFFECT_SIZE[vehicle.car]
    const intensity = Math.min(1, vehicle.speed / 260 + vehicle.slip / 100)
    const activeBoost = vehicle.driftBoost?.phase === 'active'
    if (
      vehicle.grounded &&
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
          (vehicle.currentSurface === 'grass' ? 2.2 : 3.5) * size.dust * (0.6 + 0.4 * intensity),
        ),
      )
    }
    if (
      vehicle.grounded &&
      vehicle.currentSurface === 'ice' &&
      vehicle.speed > 65 &&
      (vehicle.braking || vehicle.slip > 14) &&
      random.next() < 0.55
    ) {
      particles.push(particle('ice', vehicle, random, 0.42, 2 + intensity))
    }
    if (vehicle.grounded && vehicle.braking && vehicle.speed > 70) {
      // Keep the legacy random draws even when a loose surface uses dust instead of smoke.
      const smoke = particle('tire-smoke', vehicle, random, 0.38, 3.5 * size.smoke * intensity)
      if (vehicle.currentSurface === 'street') particles.push(smoke)
    } else if (vehicle.grounded && vehicle.currentSurface === 'street' && vehicle.speed > 70 && vehicle.slip > 24 && tick % 4 === 0) {
      // Additional presentation-only emissions never consume the race random stream.
      const visualRandom = { next: () => ((tick * 17 + vehicle.pathIndex * 13) % 19) / 19 }
      particles.push(particle('tire-smoke', vehicle, visualRandom, 0.38, 3 * size.smoke * intensity))
    }
    if (
      vehicle.player &&
      vehicle.speed > 215 &&
      random.next() < 0.45
    ) {
      const windIntensity = Math.min(1, (vehicle.speed - 215) / 150 + (activeBoost ? 0.25 : 0))
      particles.push(particle('speed-line', vehicle, random, 0.18 + 0.06 * windIntensity, (0.6 + 0.65 * windIntensity) * size.speed))
    }
    const skidThreshold =
      vehicle.currentSurface === 'ice'
        ? 17
        : vehicle.currentSurface === 'dirt'
          ? 30
          : 42
    const tires = [rearTirePoint(vehicle, -1), rearTirePoint(vehicle, 1)] as const
    const previous = state.previousTires[vehicle.id]
    const recovered = events.some(event => event.type === 'vehicle-recovered' && event.vehicleId === vehicle.id)
    if (
      !recovered &&
      vehicle.grounded &&
      vehicle.speed > 58 &&
      vehicle.currentSurface !== 'grass' &&
      (vehicle.braking || vehicle.slip > skidThreshold)
    ) {
      for (const index of [0, 1] as const) {
        const tire = tires[index]
        const from = previous?.[index] ?? { x: tire.x - vehicle.vx * dt, y: tire.y - vehicle.vy * dt }
        // Manual recovery or a discontinuous pose must not leave a long line across the map.
        if (Math.hypot(tire.x - from.x, tire.y - from.y) > vehicle.speed * dt + 12) continue
        skids.push({
          start: from, end: tire, life: 2.2, maxLife: 2.2,
          width: (vehicle.currentSurface === 'ice' ? 1 : 1.8) * size.skid,
        })
      }
    }
    if (vehicle.grounded) previousTires[vehicle.id] = tires
  }

  for (const event of events) {
    if (event.reason === 'water' && (event.type === 'vehicle-recovered' || event.type === 'race-finished')) {
      const vehicle = vehicles.find(v => event.vehicleId ? v.id === event.vehicleId : v.player)
      const x = event.x ?? vehicle?.x
      const y = event.y ?? vehicle?.y
      if (x !== undefined && y !== undefined) {
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4
          particles.push({ kind: 'water', x, y, vx: Math.cos(angle) * 32, vy: Math.sin(angle) * 32,
            life: 0.28, maxLife: 0.28, size: 2.1 })
        }
      }
    }
    if (event.type === 'vehicle-landed') {
      const vehicle = vehicles.find(({ id }) => id === event.vehicleId)
      if (!vehicle) continue
      const strength = event.strength ?? 0
      const cosine = Math.cos(vehicle.angle)
      const sine = Math.sin(vehicle.angle)
      const kind = vehicle.currentSurface === 'street' ? 'landing-dust' : vehicle.currentSurface
      for (const side of [-1, 1]) {
        for (const axle of [-1, 1]) {
          const life = 0.18 + strength * 0.14
          particles.push({
            kind,
            x: vehicle.x + axle * cosine * 10 - side * sine * 7,
            y: vehicle.y + axle * sine * 10 + side * cosine * 7,
            vx: -vehicle.vx * 0.04 - side * sine * 28 * strength,
            vy: -vehicle.vy * 0.04 + side * cosine * 28 * strength,
            life,
            maxLife: life,
            size: (1.6 + strength * 2.4) * EFFECT_SIZE[vehicle.car].landing,
          })
        }
      }
      continue
    }
  }

  let nextEmissionId = state.nextEmissionId ?? 0
  return {
    particles: particles.slice(-MAX_PARTICLES).map(item => item.emissionId === undefined
      ? { ...item, emissionId: nextEmissionId++ } : item),
    skids: skids.slice(-MAX_SKIDS),
    previousTires,
    nextEmissionId,
  }
}
