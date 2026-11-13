import { expect, it } from 'vitest'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import type { RaceState, RaceVehicle } from '@/domain/race/raceState'
import type { RoadPath } from '@/domain/track/pathBuilder'
const path = buildRoadPath([
  {x:-700,y:0,surface:'street',curve:'corner'},
  {x:0,y:0,surface:'street',curve:'corner',structure:'overpass'},
  {x:1000,y:0,surface:'street',curve:'corner'},
  {x:1700,y:0,surface:'street',curve:'corner'},
], EMPTY_TERRAIN)
const input={steering:0,throttle:1,braking:false}
const random={next:()=>0.5}
function required<T>(value: T | undefined): T { if(value===undefined) throw new Error('Missing fixture'); return value }
it('does not brake downhill even when another climb is inside the lookahead', () => {
 const road = buildRoadPath([
  { x: -300, y: 0, surface: 'street' },
  { x: 0, y: 0, surface: 'street', structure: 'overpass' },
  { x: 240, y: 0, surface: 'street' },
  { x: 360, y: 0, surface: 'street', structure: 'overpass' },
  { x: 600, y: 0, surface: 'street' },
  { x: 900, y: 0, surface: 'street' },
 ], EMPTY_TERRAIN)
 for (const reversed of [false, true]) {
  const direction = reversed ? -1 : 1
  const index = road.points.findIndex((_point, index) =>
   road.roadSurface.gradeAt(index) * direction < -0.025 &&
   Array.from({ length: 30 }, (_, offset) => road.roadSurface.gradeAt(index + direction * offset) * direction)
    .some((grade) => grade > 0.025))
  expect(index).toBeGreaterThan(0)
  const point = required(road.points[index])
  const base = createRace({ path: road, playerCar: 'blue', difficulty: 'normal', laps: 2, handling: 'arcade', reversed })
  const vehicle = required(base.vehicles[0])
  const result = stepRace({ ...base, phase: 'running', vehicles: [{
   ...vehicle, ...point, pathIndex: index, angle: reversed ? Math.PI : 0,
   vx: direction * 180, vy: 0, speed: 180, z: road.roadSurface.at(index, point).height,
   grounded: true, structureRunId: road.roadSurface.at(index, point).structureRunId,
  }] }, input, 1 / 60, random)
  expect(result.state.vehicles[0]?.braking).toBe(false)
 }
})
it.each(['arcade', 'simulation'] as const)('does not apply uphill ramp braking while descending in %s', (handling) => {
 for (const reversed of [false, true]) {
  const direction = reversed ? -1 : 1
  const index = path.points.findIndex((_point, index) =>
   path.roadSurface.gradeAt(index) * direction < -0.025)
  expect(index).toBeGreaterThan(0)
  const point = required(path.points[index])
  const base = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2, handling, reversed })
  for (const vehicle of base.vehicles) {
   const state: RaceState = { ...base, phase: 'running', vehicles: [{
    ...vehicle, ...point, pathIndex: index, angle: reversed ? Math.PI : 0,
    vx: direction * 180, vy: 0, speed: 180, z: path.roadSurface.at(index, point).height,
    grounded: true, structureRunId: path.roadSurface.at(index, point).structureRunId,
   }] }
   const next = required(stepRace(state, input, 1 / 60, random).state.vehicles[0])
   expect(next.braking, `${vehicle.id}, reverse=${reversed}`).toBe(false)
   expect(next.speed).toBeGreaterThan(175)
  }
 }
})
it('Arcade overlap has no collision impulse, damage, or contacts',()=>{
 const base=createRace({path,playerCar:'blue',difficulty:'normal',laps:2,handling:'arcade'})
 const a={...required(base.vehicles[0]),x:-400,y:0,vx:120,vy:0,speed:120,angle:0,pathIndex:50}
 const b={...a,id:'opponent',player:false,car:'red' as const}
 const race={...base,phase:'running' as const,vehicles:[a,b]}
 const together=stepRace(race,input,1/60,random)
 const alone=stepRace({...race,vehicles:[a]},input,1/60,random)
 expect(together.state.vehicles[0]).toEqual(alone.state.vehicles[0])
 expect(together.state.activeContacts).toEqual([])
 expect(together.events.some(e=>e.type==='collision'||e.type==='barrier-collision')).toBe(false)
})
function placeOnRoad(
  road: RoadPath,
  vehicle: RaceVehicle,
  index: number,
  speed: number,
  reversed: boolean,
): RaceVehicle {
  const point = required(road.points[index])
  const before = required(road.points[Math.max(0, index - 1)])
  const after = required(road.points[Math.min(road.points.length - 1, index + 1)])
  const direction = reversed ? -1 : 1
  const angle = Math.atan2(direction * (after.y - before.y), direction * (after.x - before.x))
  const support = road.roadSurface.at(index, point)
  return {
    ...vehicle,
    x: point.x,
    y: point.y,
    angle,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    speed,
    pathIndex: index,
    pathDistance: point.distance,
    z: support.height,
    grounded: true,
    contactLoad: 1,
    verticalVelocity: 0,
    structureRunId: support.structureRunId,
  }
}

it.each([
  { handling: 'arcade', reversed: false },
  { handling: 'arcade', reversed: true },
  { handling: 'simulation', reversed: false },
  { handling: 'simulation', reversed: true },
] as const)('leaves the player brakes off on a straight climb and crest ($handling, reversed=$reversed)', ({ handling, reversed }) => {
  const base = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2, handling, reversed })
  const startX = reversed ? 1200 : -200
  const start = required(nearestPathPoint(path, { x: startX, y: 0 })).index
  let race: RaceState = {
    ...base,
    phase: 'running',
    vehicles: [placeOnRoad(path, required(base.vehicles[0]), start, 220, reversed)],
  }
  const climb = reversed ? 1000 : 0
  const direction = reversed ? -1 : 1
  let climbed = false
  for (let frame = 0; frame < 160; frame += 1) {
    race = stepRace(race, input, 1 / 60, random).state
    const player = required(race.vehicles[0])
    climbed ||= path.roadSurface.gradeAt(player.pathIndex) * direction > 0.025
    expect(player.braking).toBe(false)
  }
  expect(climbed).toBe(true)
  expect((required(race.vehicles[0]).x - climb) * direction).toBeGreaterThan(250)
})

it('keeps slope gravity active while coasting without a service brake', () => {
  const index = path.points.findIndex((_, index) => path.roadSurface.gradeAt(index) > 0.1)
  expect(index).toBeGreaterThan(0)
  const coast = { ...input, throttle: 0 }
  const speeds = [false, true].map((reversed) => {
    const base = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2, handling: 'simulation', reversed })
    const player = placeOnRoad(path, required(base.vehicles[0]), index, 180, reversed)
    const stepped = stepRace({ ...base, phase: 'running', vehicles: [player] }, coast, 0.05, random)
    const next = required(stepped.state.vehicles[0])
    expect(next.braking).toBe(false)
    return next.speed
  })
  expect(required(speeds[0])).toBeLessThan(180)
  expect(required(speeds[1])).toBeGreaterThan(180)
})

it.each(['arcade', 'simulation'] as const)('preserves AI approach speeds on a straight ramp in %s', (handling) => {
  const base = createRace({ path, playerCar: 'blue', difficulty: 'normal', laps: 2, handling })
  const start = required(nearestPathPoint(path, { x: -200, y: 0 })).index
  for (const source of base.vehicles.filter((vehicle) => !vehicle.player)) {
    let race: RaceState = {
      ...base,
      phase: 'running',
      vehicles: [placeOnRoad(path, source, start, 220, false)],
    }
    for (let frame = 0; frame < 180 && required(race.vehicles[0]).x < 20; frame += 1) {
      race = stepRace(race, input, 1 / 60, random).state
    }
    expect(required(race.vehicles[0]).x).toBeGreaterThan(0)
    expect(required(race.vehicles[0]).speed).toBeLessThan(130)
  }
})

const climbingBend = buildRoadPath([
  { x: -1200, y: 0, surface: 'street' },
  { x: -250, y: 0, surface: 'street' },
  { x: 0, y: 0, surface: 'street', structure: 'overpass' },
  { x: 100, y: 0, surface: 'street', structure: 'overpass' },
  { x: 165, y: 35, surface: 'street', structure: 'overpass' },
  { x: 195, y: 100, surface: 'street', structure: 'overpass' },
  { x: 195, y: 300, surface: 'street', structure: 'overpass' },
  { x: 195, y: 1000, surface: 'street' },
], EMPTY_TERRAIN)

it.each([false, true])('only brakes the Arcade player before a curve when requested (reversed=%s)', (reversed) => {
  const base = createRace({ path: climbingBend, playerCar: 'blue', difficulty: 'normal', laps: 2, handling: 'arcade', reversed })
  const approach = reversed ? { x: 195, y: 225 } : { x: -50, y: 0 }
  const index = required(nearestPathPoint(climbingBend, approach)).index
  const player = placeOnRoad(climbingBend, required(base.vehicles[0]), index, 235, reversed)
  const state: RaceState = { ...base, phase: 'running', vehicles: [player] }
  const accelerating = required(stepRace(state, input, 1 / 60, random).state.vehicles[0])
  const braking = required(stepRace(state, { ...input, braking: true }, 1 / 60, random).state.vehicles[0])
  expect(accelerating.braking).toBe(false)
  expect(braking.braking).toBe(true)
  expect(braking.speed).toBeLessThan(accelerating.speed)
})
it('ignores any old boost state instead of adding a speed burst',()=>{
 const base=createRace({path,playerCar:'blue',difficulty:'normal',laps:2,handling:'arcade'})
 const v={...required(base.vehicles[0]),x:-600,y:0,angle:0,vx:120,vy:0,speed:120,pathIndex:required(nearestPathPoint(path,{x:-600,y:0})).index}
 const race={...base,phase:'running' as const,vehicles:[v]}
 expect(stepRace({...race,...{boostRemaining:1}},input,1/60,random).state.vehicles)
  .toEqual(stepRace(race,input,1/60,random).state.vehicles)
})
