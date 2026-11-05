import { CAR_IDS, type CarId, type DifficultyId } from '@/domain/model'
import { DIFFICULTY_SPECS, ROAD_GEOMETRY } from '@/domain/config'
import type { RoadPath } from '@/domain/track/pathBuilder'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import { createRaceEffectsState } from '@/domain/race/effects'
import type { Vector2 } from '@/domain/model'

export interface CreateRaceOptions {
  readonly path: RoadPath
  readonly playerCar: CarId
  readonly difficulty: DifficultyId
  readonly laps: number
  readonly handling?: 'arcade' | 'simulation' | undefined
  readonly startRatio?: number | undefined
  readonly reversed?: boolean | undefined
}

export interface StartGridSample extends Vector2 {
  readonly pathIndex: number
  readonly tangent: Vector2
  readonly normal: Vector2
}

export function samplePathBehindStart(
  path: RoadPath,
  backDistance: number,
  startIndex = 0,
  reversed = false,
): StartGridSample {
  const normalizedStart =
    path.points.length === 0
      ? 0
      : ((startIndex % path.points.length) + path.points.length) %
        path.points.length
  const first = path.points[normalizedStart]
  if (!first || path.points.length < 2) {
    return {
      x: first?.x ?? 0,
      y: first?.y ?? 0,
      pathIndex: 0,
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
    }
  }
  let remaining = Math.max(0, backDistance)
  let current: Vector2 = first
  for (let step = 1; step <= path.points.length; step += 1) {
    const index = reversed
      ? (normalizedStart + step) % path.points.length
      : (normalizedStart - step + path.points.length) % path.points.length
    const previous = path.points[index]
    if (!previous) continue
    const dx = current.x - previous.x
    const dy = current.y - previous.y
    const segmentLength = Math.hypot(dx, dy)
    if (segmentLength < 0.001) {
      current = previous
      continue
    }
    const tangent = {
      x: dx / segmentLength,
      y: dy / segmentLength,
    }
    if (remaining <= segmentLength || step === path.points.length) {
      const ratio = Math.min(1, remaining / segmentLength)
      return {
        x: current.x + (previous.x - current.x) * ratio,
        y: current.y + (previous.y - current.y) * ratio,
        pathIndex: reversed && ratio < 0.5
          ? (index - 1 + path.points.length) % path.points.length
          : index,
        tangent,
        normal: { x: -tangent.y, y: tangent.x },
      }
    }
    remaining -= segmentLength
    current = previous
  }
  const second =
    path.points[
      (normalizedStart + (reversed ? -1 : 1) + path.points.length) %
        path.points.length
    ] ?? first
  const length = Math.max(0.001, Math.hypot(second.x - first.x, second.y - first.y))
  const tangent = {
    x: (second.x - first.x) / length,
    y: (second.y - first.y) / length,
  }
  return {
    x: first.x,
    y: first.y,
    pathIndex: normalizedStart,
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
  }
}

export function createRace(options: CreateRaceOptions): RaceState {
  const difficulty = DIFFICULTY_SPECS[options.difficulty]
  const aiCars: readonly CarId[] =
    options.difficulty === 'hard'
      ? [options.playerCar, ...CAR_IDS.filter((car) => car !== options.playerCar)]
      : CAR_IDS.filter((car) => car !== options.playerCar)

  const startDistance =
    options.path.totalLength *
    Math.max(0, Math.min(0.999_999, options.startRatio ?? 0))
  const startPathIndex = options.path.points.findIndex(
    (point) => point.distance >= startDistance,
  )
  const resolvedStartIndex = Math.max(0, startPathIndex)
  const vehicles: RaceVehicle[] = ROAD_GEOMETRY.startGrid.map((grid, index) => {
    const placement = samplePathBehindStart(
      options.path,
      grid.back,
      resolvedStartIndex,
      options.reversed ?? false,
    )
    const position = {
      x: placement.x + placement.normal.x * grid.lane,
      y: placement.y + placement.normal.y * grid.lane,
    }
    const roadSurface = options.path.roadSurface.at(
      placement.pathIndex,
      position,
    )
    return {
      id: index === 0 ? 'player' : `ai-${index}`,
      car: index === 0 ? options.playerCar : (aiCars[index - 1] ?? 'blue'),
      player: index === 0,
      ...position,
      angle: Math.atan2(placement.tangent.y, placement.tangent.x),
      vx: 0,
      vy: 0,
      yawRate: 0,
      speed: 0,
      slip: 0,
      braking: false,
      lane: options.reversed ? -grid.lane : grid.lane,
      ai:
        index === 0
          ? null
          : createAiDriverState(ROAD_GEOMETRY.aiBaseLanes[index] ?? 0),
      aiPace:
        index === 0
          ? 1
          : (('aiPaces' in difficulty
              ? difficulty.aiPaces[index - 1]
              : undefined) ??
            (0.985 - (index - 1) * 0.008)),
      pathIndex: placement.pathIndex,
      pathDistance: options.path.points[placement.pathIndex]?.distance ?? 0,
      z: roadSurface.height,
      verticalVelocity: 0,
      grounded: true,
      suspensionCompression: 0,
      landingIntensity: 0,
      contactLoad: 1,
      structureRunId: roadSurface.structureRunId,
      nextSector: 1,
      lap: 0,
      damage: 0,
      damageLimit: index === 0 ? difficulty.damageLimit : Number.POSITIVE_INFINITY,
      damageCooldown: 0,
      wrecked: false,
      currentSurface: 'street',
      onCurb: false,
      stuckDuration: 0,
      finishedAt: null,
    }
  })

  return {
    path: options.path,
    vehicles,
    difficulty: options.difficulty,
    handling: options.handling ?? 'simulation',
    totalLaps: Math.max(1, Math.floor(options.laps)),
    startPathIndex: resolvedStartIndex,
    reversed: options.reversed ?? false,
    elapsed: 0,
    phase: 'countdown',
    countdown: 3.7,
    paused: false,
    activeContacts: [],
    boostCharge: 0,
    boostRemaining: 0,
    cameraHints: {
      target: {
        x: vehicles[0]?.x ?? 0,
        y: vehicles[0]?.y ?? 0,
      },
      roadAngle: vehicles[0]?.angle ?? 0,
      upcomingCurve: 0,
      speed: 0,
      shake: 0,
    },
    effects: createRaceEffectsState(),
  }
}
