import { raceRivalPace } from '@/domain/race/ai/difficultyPolicy'
import { CAR_IDS, type CarId, type DifficultyId, type RouteKind } from '@/domain/model'
import { ROAD_GEOMETRY } from '@/domain/config'
import type { RoadPath } from '@/domain/track/pathBuilder'
import { resolveRecoveryCheckpoints } from '@/domain/track/recoveryCheckpoints'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { createAiDriverState } from '@/domain/race/ai/aiState'
import { createRaceEffectsState } from '@/domain/race/effects'
import { EXTRA_NEARBY_GRID, validNearbyGridPositions } from '@/domain/race/startGrid'
import type { Vector2 } from '@/domain/model'

export interface CreateRaceOptions {
  readonly path: RoadPath
  readonly routeKind?: RouteKind
  readonly recoveryCheckpoints?: readonly number[] | undefined
  readonly playerCar: CarId
  readonly difficulty: DifficultyId
  readonly laps: number
  readonly startRatio?: number | undefined
  readonly reversed?: boolean | undefined
  /** Vehicle index -> physical start slot, validated independently from vehicle IDs. */
  readonly gridPositions?: readonly number[] | undefined
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

function sampleOpenStart(path: RoadPath): StartGridSample {
  const first = path.points[0] ?? { x: 0, y: 0 }
  const second = path.points[1] ?? { x: first.x + 1, y: first.y }
  const dx = second.x - first.x
  const dy = second.y - first.y
  const length = Math.max(0.001, Math.hypot(dx, dy))
  const tangent = { x: dx / length, y: dy / length }
  return { x: first.x, y: first.y, pathIndex: 0, tangent, normal: { x: -tangent.y, y: tangent.x } }
}

export function createRace(options: CreateRaceOptions): RaceState {
  const aiCars: readonly CarId[] =
    options.difficulty === 'hard'
      ? [options.playerCar, ...CAR_IDS.filter((car) => car !== options.playerCar)]
      : CAR_IDS.filter((car) => car !== options.playerCar)

  const open = options.routeKind === 'point-to-point'
  const startDistance =
    options.path.totalLength *
    (open ? 0 : Math.max(0, Math.min(0.999_999, options.startRatio ?? 0)))
  const startPathIndex = options.path.points.findIndex(
    (point) => point.distance >= startDistance,
  )
  const resolvedStartIndex = Math.max(0, startPathIndex)
  const recoveryCheckpoints = resolveRecoveryCheckpoints(options.path, options.recoveryCheckpoints)
  const sampleCount = options.path.points.length
  const reversed = !open && (options.reversed ?? false)
  const routeProgress = (index: number): number => open ? index :
    (((reversed ? resolvedStartIndex - index : index - resolvedStartIndex) % sampleCount) + sampleCount) % sampleCount
  const timingGates = recoveryCheckpoints
    .filter(index => index !== resolvedStartIndex && (!open || index > 0))
    .sort((a, b) => routeProgress(a) - routeProgress(b))
  const openPlacement = open ? sampleOpenStart(options.path) : undefined
  const slots = validNearbyGridPositions(options.gridPositions) ? options.gridPositions : [0, 1, 2, 3]
  const vehicles: RaceVehicle[] = ROAD_GEOMETRY.startGrid.map((_, index) => {
    const gridSlot = slots[index] ?? index
    const grid = ROAD_GEOMETRY.startGrid[gridSlot] ?? EXTRA_NEARBY_GRID[gridSlot - ROAD_GEOMETRY.startGrid.length]
    if (!grid) throw new RangeError('Invalid player grid pad.')

    const placement = openPlacement ?? samplePathBehindStart(
      options.path,
      grid.back,
      resolvedStartIndex,
      options.reversed,
    )
    const lane = open ? ROAD_GEOMETRY.lanes[gridSlot] ?? grid.lane : grid.lane
    const position = {
      x: placement.x + placement.normal.x * lane,
      y: placement.y + placement.normal.y * lane,
    }
    const roadSurface = options.path.roadSurface.at(
      placement.pathIndex,
      position,
    )
    const car = index === 0 ? options.playerCar : (aiCars[index - 1] ?? 'blue')
    return {
      id: index === 0 ? 'player' : `ai-${index}`,
      car,
      player: index === 0,
      ...position,
      angle: Math.atan2(placement.tangent.y, placement.tangent.x),
      vx: 0,
      vy: 0,
      yawRate: 0,
      speed: 0,
      slip: 0,
      braking: false,
      lane: !open && options.reversed ? -lane : lane,
      ai:
        index === 0
          ? null
          : createAiDriverState(ROAD_GEOMETRY.aiBaseLanes[gridSlot] ?? 0,
              (['cautious', 'steady', 'opportunist'] as const)[index - 1]),
      aiPace: index === 0 ? 1 : raceRivalPace(index - 1),
      pathIndex: placement.pathIndex,
      ...(index === 0 ? { lastRoadContactIndex: placement.pathIndex } : {}),
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
      currentSurface: 'street',
      onCurb: false,
      stuckDuration: 0,
      finishedAt: null,
    }
  })

  return {
    path: options.path,
    routeKind: options.routeKind ?? 'circuit',
    vehicles,
    difficulty: options.difficulty,
    totalLaps: open ? 1 : Math.max(1, Math.floor(options.laps)),
    startPathIndex: resolvedStartIndex,
    ...(recoveryCheckpoints.length ? { recoveryCheckpoints } : {}),
    timingGates,
    reversed: open ? false : options.reversed ?? false,
    tick: 0,
    elapsed: 0,
    phase: 'countdown',
    countdown: 3.7,
    paused: false,
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
