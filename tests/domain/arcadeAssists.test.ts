import { expect, it } from 'vitest'
import { buildRoadPath, nearestPathPoint } from '@/domain/track/pathBuilder'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'
import { createRace } from '@/domain/race/raceFactory'
import { stepRace } from '@/domain/race/raceEngine'
import type { RaceState } from '@/domain/race/raceState'
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
it.each(['arcade','simulation'] as const)('all cars slow before the ramp in %s',handling=>{
 const base=createRace({path,playerCar:'blue',difficulty:'normal',laps:2,handling})
 for(const source of base.vehicles){
  let race:RaceState={...base,phase:'running',vehicles:[{...source,x:-200,y:0,vx:220,vy:0,speed:220,angle:0,pathIndex:required(nearestPathPoint(path,{x:-200,y:0})).index}]}
  for(let i=0;i<180 && required(race.vehicles[0]).x<20;i++) race=stepRace(race,input,1/60,random).state
  expect(required(race.vehicles[0]).x).toBeGreaterThan(0)
  expect(required(race.vehicles[0]).speed).toBeLessThan(130)
 }
})

it('slows before ramps in reverse',()=>{
 const base=createRace({path,playerCar:'blue',difficulty:'normal',laps:2,handling:'arcade',reversed:true})
 let race:RaceState={...base,phase:'running',vehicles:[{...required(base.vehicles[0]),x:1200,y:0,angle:Math.PI,vx:-220,vy:0,speed:220,pathIndex:required(nearestPathPoint(path,{x:1200,y:0})).index}]}
 for(let i=0;i<180&&required(race.vehicles[0]).x>980;i++)race=stepRace(race,input,1/60,random).state
 expect(required(race.vehicles[0]).x).toBeLessThan(1000)
 expect(required(race.vehicles[0]).speed).toBeLessThan(130)
})
it('ignores any old boost state instead of adding a speed burst',()=>{
 const base=createRace({path,playerCar:'blue',difficulty:'normal',laps:2,handling:'arcade'})
 const v={...required(base.vehicles[0]),x:-600,y:0,angle:0,vx:120,vy:0,speed:120,pathIndex:required(nearestPathPoint(path,{x:-600,y:0})).index}
 const race={...base,phase:'running' as const,vehicles:[v]}
 expect(stepRace({...race,...{boostRemaining:1}},input,1/60,random).state.vehicles)
  .toEqual(stepRace(race,input,1/60,random).state.vehicles)
})
