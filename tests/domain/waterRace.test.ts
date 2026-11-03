import { describe, expect, it } from 'vitest'
import { WORLD_ELEVATION } from '@/domain/config'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import {
  findNearestSafeTrackIndex,
  getVehicleStepContext,
  reconcileSupportAfterCollision,
} from '@/domain/race/trackContext'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import { hasVehicleWaterContact } from '@/domain/track/waterExposure'

const noInput = { steering: 0, throttle: 0, braking: false }
const random = { next: () => 0.5 }
const water = {
  cellSize: WORLD_ELEVATION.cellSize,
  cells: [{ column: 0, row: 0, kind: 'water' as const }],
}
const dryLoop = [
  { id: 'north', x: -200, y: -200, surface: 'street' as const },
  { id: 'east', x: 200, y: -200, surface: 'street' as const },
  { id: 'south', x: 200, y: 200, surface: 'street' as const },
  { id: 'west', x: -200, y: 200, surface: 'street' as const },
  { id: 'close', x: -200, y: -200, surface: 'street' as const },
]

function runningRace(): RaceState {
  return {
    ...createRace({
      path: buildRoadPath(dryLoop, water),
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    }),
    phase: 'running',
    countdown: 0,
  }
}

function atWater(vehicle: RaceVehicle): RaceVehicle {
  return {
    ...vehicle,
    x: 16,
    y: 16,
    z: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    grounded: true,
    verticalVelocity: 0,
    contactLoad: 1,
  }
}

function roadBoundaryRace() {
  const path = buildRoadPath(
    [
      { id: 'water-road', x: -200, y: 16, surface: 'street' },
      { id: 'east', x: 200, y: 16, surface: 'street' },
      { id: 'south-east', x: 200, y: 216, surface: 'street' },
      { id: 'south-west', x: -200, y: 216, surface: 'street' },
      { id: 'close', x: -200, y: 16, surface: 'street' },
    ],
    water,
  )
  return {
    ...createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    }),
    phase: 'running' as const,
    countdown: 0,
  }
}

function hillWaterBoundaryRace() {
  const path = buildRoadPath(
    [
      { id: 'hill-water', x: -200, y: 16, surface: 'street' },
      { id: 'east', x: 200, y: 16, surface: 'street' },
      { id: 'south-east', x: 200, y: 216, surface: 'street' },
      { id: 'south-west', x: -200, y: 216, surface: 'street' },
      { id: 'close', x: -200, y: 16, surface: 'street' },
    ],
    {
      cellSize: WORLD_ELEVATION.cellSize,
      cells: [
        { column: -1, row: 0, kind: 'hill' as const },
        { column: 0, row: 0, kind: 'water' as const },
      ],
    },
  )
  return {
    ...createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    }),
    phase: 'running' as const,
    countdown: 0,
  }
}

function hillBoundaryCollisionState(pushedIndex: 0 | 1) {
  const initial = hillWaterBoundaryRace()
  const supportHeight = initial.path.terrainSurface.heightAt({
    x: -1,
    y: 16,
  })
  return {
    initial,
    supportHeight,
    state: {
      ...initial,
      vehicles: initial.vehicles.map((vehicle, index) =>
        index < 2
          ? {
              ...vehicle,
              x: index === pushedIndex ? -1 : -2,
              y: 16,
              z: supportHeight,
              vx: 0,
              vy: 0,
              speed: 0,
              grounded: true,
              verticalVelocity: 0,
              contactLoad: 1,
            }
          : vehicle,
      ),
    },
  }
}

describe('water race contact', () => {
  it('ends the player race immediately and emits the terminal reason once', () => {
    const initial = runningRace()
    const state = {
      ...initial,
      vehicles: initial.vehicles.map((vehicle) =>
        vehicle.player ? atWater(vehicle) : vehicle,
      ),
    }

    const sunk = stepRace(state, noInput, 1 / 60, random)
    const repeated = stepRace(sunk.state, noInput, 1 / 60, random)

    expect(sunk.state.phase).toBe('finished')
    expect(
      sunk.events.filter((event) => event.type === 'race-finished'),
    ).toEqual([{ type: 'race-finished', reason: 'water' }])
    expect(repeated.events).toEqual([])
  })

  it('recovers grounded AI from water without ending the player race', () => {
    const initial = roadBoundaryRace()
    const { path } = initial
    const pathIndex = path.points.findIndex(
      (point) => path.terrainSurface.materialAt(point) === 'water',
    )
    const position = path.points[pathIndex]
    if (!position) throw new Error('Expected surface-road water sample')
    const state = {
      ...initial,
      vehicles: initial.vehicles.map((vehicle, index) =>
        index === 1
          ? {
              ...vehicle,
              ...position,
              pathIndex,
              z: 0,
              vx: 40,
              speed: 40,
              grounded: true,
            }
          : vehicle,
      ),
    }

    const result = stepRace(state, noInput, 1 / 60, random)
    const recovered = result.state.vehicles[1]

    expect(result.state.phase).toBe('running')
    expect(
      recovered && path.terrainSurface.materialAt(recovered),
    ).not.toBe('water')
    expect(recovered?.speed).toBe(0)
    expect(recovered?.grounded).toBe(true)

    const resumed = stepRace(result.state, noInput, 0.05, random)
    expect(resumed.state.vehicles[1]?.speed).toBeGreaterThan(0)
  })

  it('chooses deterministic trailing recovery samples in either direction', () => {
    const initial = roadBoundaryRace()
    const wetIndex = initial.path.points.findIndex(
      (point) => initial.path.terrainSurface.materialAt(point) === 'water',
    )
    const wetPoint = initial.path.points[wetIndex]
    const ai = initial.vehicles[1]
    if (!wetPoint || !ai) throw new Error('Expected wet recovery fixture')
    const vehicle = {
      ...ai,
      ...wetPoint,
      pathIndex: wetIndex,
      z: initial.path.roadSurface.at(wetIndex, wetPoint).height,
    }

    const forward = findNearestSafeTrackIndex(initial.path, vehicle)
    const forwardRepeated = findNearestSafeTrackIndex(initial.path, vehicle)
    const reversed = findNearestSafeTrackIndex(initial.path, vehicle, true)
    const reversedRepeated = findNearestSafeTrackIndex(
      initial.path,
      vehicle,
      true,
    )

    expect(forward).toBe(forwardRepeated)
    expect(reversed).toBe(reversedRepeated)
    expect(
      forward === undefined
        ? undefined
        : initial.path.terrainSurface.materialAt(
            initial.path.points[forward] ?? wetPoint,
          ),
    ).not.toBe('water')
    expect(
      reversed === undefined
        ? undefined
        : initial.path.terrainSurface.materialAt(
            initial.path.points[reversed] ?? wetPoint,
          ),
    ).not.toBe('water')
  })

  it('does not sink an airborne vehicle until it lands in water', () => {
    const initial = runningRace()
    const airborne = {
      ...atWater(initial.vehicles[0] as RaceVehicle),
      z: 12,
      grounded: false,
      verticalVelocity: 0,
      contactLoad: 0,
    }
    const state = {
      ...initial,
      vehicles: initial.vehicles.map((vehicle) =>
        vehicle.player ? airborne : vehicle,
      ),
    }

    const result = stepRace(state, noInput, 1 / 60, random)

    expect(result.state.phase).toBe('running')
    expect(result.state.vehicles[0]?.grounded).toBe(false)
    expect(
      result.events.some((event) => event.type === 'race-finished'),
    ).toBe(false)

    const landing = stepRace(
      {
        ...initial,
        vehicles: initial.vehicles.map((vehicle) =>
          vehicle.player
            ? {
                ...atWater(vehicle),
                z: 0.1,
                grounded: false,
                verticalVelocity: -18,
                contactLoad: 0,
              }
            : vehicle,
        ),
      },
      noInput,
      1 / 30,
      random,
    )
    expect(landing.state.phase).toBe('finished')
    expect(landing.events).toContainEqual({
      type: 'race-finished',
      reason: 'water',
    })
  })

  it('does not reset airborne AI merely passing over water', () => {
    const initial = runningRace()
    const state = {
      ...initial,
      vehicles: initial.vehicles.map((vehicle, index) =>
        index === 1
          ? {
              ...atWater(vehicle),
              z: 12,
              vx: 40,
              speed: 40,
              grounded: false,
              contactLoad: 0,
            }
          : vehicle,
      ),
    }

    const result = stepRace(state, noInput, 1 / 60, random)
    const airborne = result.state.vehicles[1]

    expect(result.state.phase).toBe('running')
    expect(airborne?.grounded).toBe(false)
    expect(airborne?.speed).toBeGreaterThan(0)
  })

  it('only treats a sufficiently raised overpass deck as safe above water', () => {
    const points = [
      {
        id: 'approach',
        x: -300,
        y: 16,
        surface: 'street' as const,
        structure: 'overpass' as const,
      },
      {
        id: 'deck',
        x: 300,
        y: 16,
        surface: 'street' as const,
        structure: 'overpass' as const,
      },
      {
        id: 'exit',
        x: 600,
        y: 16,
        surface: 'street' as const,
        structure: 'surface' as const,
      },
    ]
    const path = buildRoadPath(points, water)
    const pathIndex = path.points.findIndex(
      (point, index) =>
        path.terrainSurface.materialAt(point) === 'water' &&
        path.roadSurface.at(index).structureHeight >
          WORLD_ELEVATION.levelHeight / 2,
    )
    expect(pathIndex).toBeGreaterThanOrEqual(0)
    const position = path.points[pathIndex]
    if (!position) throw new Error('Expected over-water deck sample')
    const deck = path.roadSurface.at(pathIndex, position)
    const race = createRace({
      path,
      playerCar: 'blue',
      difficulty: 'normal',
      laps: 3,
    })
    const player = {
      ...(race.vehicles[0] as RaceVehicle),
      ...position,
      pathIndex,
      z: deck.height,
      structureRunId: deck.structureRunId,
      grounded: true,
    }
    const context = getVehicleStepContext(path, player)

    expect(context).toMatchObject({
      terrainMaterial: 'water',
      safeAboveWater: true,
    })
    expect(reconcileSupportAfterCollision(player, context)).toBe(player)
    const underDeck = {
      ...player,
      z: deck.terrainHeight,
    }
    const underDeckContext = getVehicleStepContext(path, underDeck)
    expect(
      reconcileSupportAfterCollision(underDeck, underDeckContext),
    ).toBe(underDeck)
    expect(
      hasVehicleWaterContact({
        grounded: underDeck.grounded,
        terrainMaterial: underDeckContext.terrainMaterial,
        safeAboveWater: underDeckContext.safeAboveWater,
      }),
    ).toBe(true)
    const result = stepRace(
      {
        ...race,
        phase: 'running',
        countdown: 0,
        vehicles: race.vehicles.map((vehicle) =>
          vehicle.player ? player : vehicle,
        ),
      },
      noInput,
      1 / 60,
      random,
    )
    expect(result.state.phase).toBe('running')

    const surfacePath = buildRoadPath(
      points.map((point) => ({ ...point, structure: 'surface' as const })),
      water,
    )
    const surfaceContext = getVehicleStepContext(surfacePath, {
      ...player,
      z: 0,
    })
    expect(surfaceContext).toMatchObject({
      terrainMaterial: 'water',
      safeAboveWater: false,
    })
  })

  it('classifies water from the player position after collision resolution', () => {
    const initial = roadBoundaryRace()
    const state = {
      ...initial,
      vehicles: initial.vehicles.map((vehicle, index) =>
        index === 0
          ? {
              ...vehicle,
              x: -1,
              y: 16,
              z: 0,
              vx: 0,
              vy: 0,
              speed: 0,
              grounded: true,
            }
          : index === 1
            ? {
                ...vehicle,
                x: -2,
                y: 16,
                z: 0,
                vx: 0,
                vy: 0,
                speed: 0,
                grounded: true,
              }
            : vehicle,
      ),
    }

    const result = stepRace(state, noInput, 0.001, random)
    const player = result.state.vehicles.find(({ player }) => player)

    expect(player && initial.path.terrainSurface.materialAt(player)).toBe(
      'water',
    )
    expect(result.state.phase).toBe('finished')
    expect(result.events).toContainEqual({
      type: 'race-finished',
      reason: 'water',
    })
  })

  it('does not classify water when collision resolution moves the player out', () => {
    const initial = roadBoundaryRace()
    const state = {
      ...initial,
      vehicles: initial.vehicles.map((vehicle, index) =>
        index === 0
          ? {
              ...vehicle,
              x: 31,
              y: 16,
              z: 0,
              vx: 0,
              vy: 0,
              speed: 0,
              grounded: true,
            }
          : index === 1
            ? {
                ...vehicle,
                x: 30,
                y: 16,
                z: 2,
                vx: 0,
                vy: 0,
                speed: 0,
                grounded: false,
                verticalVelocity: 10,
                contactLoad: 0,
              }
            : vehicle,
      ),
    }

    const result = stepRace(state, noInput, 0.001, random)
    const player = result.state.vehicles.find(({ player }) => player)

    expect(player && initial.path.terrainSurface.materialAt(player)).not.toBe(
      'water',
    )
    expect(result.state.phase).toBe('running')
    expect(
      result.events.some((event) => event.type === 'race-finished'),
    ).toBe(false)
  })

  it('becomes airborne when collision removes elevated ground support, then sinks on landing', () => {
    const { initial, state, supportHeight } =
      hillBoundaryCollisionState(0)
    expect(supportHeight).toBeGreaterThan(0)

    let result = stepRace(state, noInput, 0.001, random)
    const launched = result.state.vehicles.find(({ player }) => player)

    expect(
      launched && initial.path.terrainSurface.materialAt(launched),
    ).toBe('water')
    expect(launched).toMatchObject({
      grounded: false,
      contactLoad: 0,
    })
    expect(launched?.z).toBeCloseTo(supportHeight)
    expect(launched?.verticalVelocity).toBeLessThanOrEqual(0)
    expect(result.state.phase).toBe('running')

    for (
      let frame = 0;
      frame < 10 && result.state.phase === 'running';
      frame += 1
    ) {
      result = stepRace(result.state, noInput, 0.05, random)
    }
    expect(result.state.phase).toBe('finished')
    expect(result.events).toContainEqual({
      type: 'race-finished',
      reason: 'water',
    })
  })

  it('uses the same post-collision support transition for AI', () => {
    const { initial, state, supportHeight } =
      hillBoundaryCollisionState(1)

    let result = stepRace(state, noInput, 0.001, random)
    const launched = result.state.vehicles[1]

    expect(
      launched && initial.path.terrainSurface.materialAt(launched),
    ).toBe('water')
    expect(launched).toMatchObject({
      grounded: false,
      contactLoad: 0,
    })
    expect(launched?.z).toBeCloseTo(supportHeight)
    expect(launched?.verticalVelocity).toBeLessThanOrEqual(0)

    for (
      let frame = 0;
      frame < 10 &&
      result.state.vehicles[1]?.grounded === false;
      frame += 1
    ) {
      result = stepRace(result.state, noInput, 0.05, random)
    }
    const recovered = result.state.vehicles[1]
    expect(recovered?.grounded).toBe(true)
    expect(
      recovered && initial.path.terrainSurface.materialAt(recovered),
    ).not.toBe('water')
  })

  it('gives post-collision water priority over a same-frame finish', () => {
    const path = buildRoadPath(
      [
        { id: 'start', x: -1, y: 16, surface: 'street' },
        { id: 'east', x: 300, y: 16, surface: 'street' },
        { id: 'south-east', x: 300, y: 300, surface: 'street' },
        { id: 'south-west', x: -1, y: 300, surface: 'street' },
        { id: 'close', x: -1, y: 16, surface: 'street' },
      ],
      water,
    )
    const initial = {
      ...createRace({
        path,
        playerCar: 'blue',
        difficulty: 'normal',
        laps: 1,
      }),
      phase: 'running' as const,
      countdown: 0,
    }
    const state = {
      ...initial,
      vehicles: initial.vehicles.map((vehicle, index) =>
        index === 0
          ? {
              ...vehicle,
              x: -1,
              y: 16,
              z: 0,
              pathIndex: path.points.length - 2,
              nextSector: 4 as const,
              vx: 0,
              vy: 0,
              speed: 0,
              grounded: true,
            }
          : index === 1
            ? {
                ...vehicle,
                x: -2,
                y: 16,
                z: 0,
                vx: 0,
                vy: 0,
                speed: 0,
                grounded: true,
              }
            : vehicle,
      ),
    }

    const result = stepRace(state, noInput, 0.001, random)
    const player = result.state.vehicles.find(({ player }) => player)

    expect(result.events).toContainEqual({
      type: 'race-finished',
      reason: 'water',
    })
    expect(
      result.events.some(
        (event) =>
          event.type === 'vehicle-finished' &&
          event.vehicleId === 'player',
      ),
    ).toBe(false)
    expect(player?.finishedAt).toBeNull()
  })
})
