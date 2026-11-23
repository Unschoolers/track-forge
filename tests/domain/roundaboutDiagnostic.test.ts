// @vitest-environment node
// Regression fixture from the exported Roundabout track.
// Original road controls and terrain cells are retained via compact row ranges.
import { it, expect } from 'vitest'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { runLaneCheck } from '../../qa/lanes/simulation'
import type { TerrainCell } from '@/domain/model'
import type { CarId } from '@/domain/model'
import { CAR_DRIVING_PROFILES, type CarDrivingProfile } from '@/domain/race/ai/aiCarDrivingProfiles'

const hill = "-14,-23,-20;-14,-13,-7;-13,-42,-39;-13,-29,-4;-12,-44,-37;-12,-31,0;-11,-44,-37;-11,-32,4;-10,-45,-36;-10,-33,7;-9,-45,12;-8,-45,16;-7,-45,19;-6,-44,26;-5,-44,35;-5,37,42;-4,-43,43;-3,-43,43;-2,-42,44;-1,-41,44;0,-40,44;1,-39,44;2,-39,43;3,-37,43;4,-36,43;5,-35,43;6,-34,43;7,-33,42;8,-31,42;9,-29,41;10,-27,40;11,-25,38;12,-23,35;13,-20,23;14,-17,21;15,-14,19;16,-9,16;17,-3,9;22,-45,-43;23,-46,-42;24,-47,-41;25,-49,-41;26,-50,-42;27,-51,-42;27,49,51;28,-52,-43;28,48,52;29,-53,-45;29,47,53;30,-53,-47;30,46,53;31,-53,-48;31,45,52;32,-53,-48;32,45,51;33,-54,-49;33,44,50;34,-54,-49;34,42,49;35,-54,-49;35,41,49;36,-54,-49;36,39,48;37,-54,-44;37,34,47;38,-54,-43;38,32,46;39,-53,-43;39,32,45;40,-53,-43;40,31,43;41,-52,-43;41,31,42;42,-48,-44;42,32,39;43,33,34;53,66,70;54,-16,0;54,65,71;55,-20,4;55,13,17;55,64,72;56,-23,7;56,12,18;56,64,72;57,-27,19;57,63,72;58,-29,20;58,62,72;59,-31,22;59,60,72;60,-35,25;60,59,72;61,-42,28;61,58,72;62,-52,30;62,57,71;63,-57,31;63,41,46;63,55,70;64,-60,47;64,53,70;65,-61,69;66,-62,68;67,-62,67;68,-69,66;69,-70,65;70,-71,63;71,-71,62;72,-71,61;73,-72,60;74,-71,59;75,-71,58;76,-70,57;77,-69,55;78,-68,53;79,-67,50;80,-65,14;80,17,48;81,-64,14;81,21,45;82,-62,14;82,30,36;83,-61,14;84,-61,14;85,-61,13;86,-61,13;87,-60,12;88,-60,11;89,-60,10;90,-59,8;91,-59,5;92,-58,3;93,-57,1;94,-56,-17;94,-14,-1;95,-55,-18;95,-13,-4;96,-54,-18;96,-10,-8;97,-52,-18;98,-50,-31;98,-27,-18;99,-46,-36;99,-26,-18;100,-25,-19;101,-24,-20"
const water = "27,-41,-37;28,-42,-36;29,-44,-35;30,-46,-35;31,-47,-35;32,-47,-35;33,-48,-35;34,-48,-34;35,-48,-34;36,-48,-35;37,-43,-36;38,-42,-38;39,-42,-41"
const points: readonly (readonly [number, number])[] = [[-1645.4183388555584,434.86606214953736],[-193.08700282657753,789.1674828056284],[979.9131588845556,743.7544740135058],[1787.161777918077,684.3247322140742],[2055.013943810501,991.2207569640836],[2062.795711541466,1331.2966429472626],[1913.5560656075263,1623.881547363696],[1016.5811713340021,1626.5917631615453],[48.31270891899453,1241.5936840754061],[-840.9687523851799,1370.9640490474658],[-1904.9992401239774,1661.8454196948805],[-2011.9199535524717,935.2180498889319],[-1593.718084182229,428.335727062393]]
function expand(kind: 'hill' | 'water', spans: string): TerrainCell[] {
  return spans.split(';').flatMap(span => {
    const [row, start, end] = span.split(',').map(Number)
    if (row === undefined || start === undefined || end === undefined) throw Error('Bad source terrain')
    return Array.from({ length: end - start + 1 }, (_, index) => ({
      kind, row, column: start + index,
    }))
  })
}

// All seeds drive the exact same authored geometry. Compiling its thousands of
// terrain cells once keeps the regression about driving, not fixture setup.
const path = buildRoadPath(points.map(([x, y], i) => ({
  x, y, surface: 'street' as const, curve: 'smooth' as const, tension: 0.5,
  structure: 'surface' as const, id: 'point-' + i,
})), { cellSize: 32, cells: [...expand('hill', hill), ...expand('water', water)] })

it.each([1, 4331, 98765])('keeps Green on the Roundabout course through both laps (seed %i)', (seed) => {
  const run = runLaneCheck({
    path, trackName: 'Roundabout', seed, difficulty: 'hard',
    mode: 'traffic', car: 'red', handling: 'arcade',
    reversed: false, startRatio: 0.7746478873239436,
    laps: 2, seconds: 110,
  })

  const green = run.vehicles.find(vehicle => vehicle.vehicleId === 'ai-3')
  const blue = run.vehicles.find(vehicle => vehicle.vehicleId === 'ai-2')
  expect(run.stoppedReason).toBe('finished')
  expect(run.vehicles).toHaveLength(4)
  expect(green).toMatchObject({ car: 'green', laps: 2, recoveries: 0 })
  expect(blue).toMatchObject({ car: 'blue', laps: 2, recoveries: 0 })
  expect(green?.finishedAt).not.toBeNull()
  expect(run.issues.filter(issue =>
    issue.vehicleId === 'ai-3' && (issue.code === 'recovery' || issue.code === 'timeout'),
  )).toEqual([])
}, 120000)


// Opt-in diagnostic: reproduce Blue's twice-per-race off-road recovery from the
// real Normal Roundabout replay, then exercise Hard candidate driving profiles
// in 4-car traffic. Keep published tests independent of profile mutations.
// Exported hard race physical slots, rather than a generic seed's 0-1-2-3 order.
const replayGrid = [2, 1, 0, 3] as const
const profileSweep = process.env.AI_ROUNDABOUT_SWEEP === '1' ? it : it.skip
profileSweep('logs Roundabout Blue traffic pace and hairpin safety by strategy', () => {
  const original = CAR_DRIVING_PROFILES.blue
  const cases: readonly { label: string, changes: Partial<CarDrivingProfile> }[] = [
    { label: 'current', changes: {} },
    { label: 'edge0-corner006', changes: { hardEdgeAvoidanceScale: 0, hardCornerTargetBonus: 0.06 } },
    { label: 'edge01-corner004', changes: { hardEdgeAvoidanceScale: 0.1, hardCornerTargetBonus: 0.04 } },
    { label: 'edge01-corner006', changes: { hardEdgeAvoidanceScale: 0.1, hardCornerTargetBonus: 0.06 } },
    { label: 'steer262', changes: { hardSteerGain: 2.62 } },
    { label: 'gain255-preview8', changes: { hardSteerGain: 2.55, hardLookAheadSamples: 8 } },
    { label: 'reaction10-gain27-preview8', changes: { hardReaction: 10, hardSteerGain: 2.7, hardLookAheadSamples: 8 } },
    { label: 'edge025-corner004', changes: { hardEdgeAvoidanceScale: 0.25, hardCornerTargetBonus: 0.04 } },
    { label: 'edge04-corner006', changes: { hardEdgeAvoidanceScale: 0.4, hardCornerTargetBonus: 0.06 } },
  ]
  const results: { label: string, difficulty: string, blue: unknown, blueRecoveries: unknown[] }[] = []
  for (const strategy of cases) {
      const aiProfileOverrides = { blue: { ...original, ...strategy.changes } }
      for (const seed of [1, 4331]) {
        const run = runLaneCheck({
          path, trackName: 'Roundabout', seed, difficulty: 'hard',
          mode: 'traffic', car: 'red', handling: 'arcade',
          gridPositions: replayGrid,
          aiProfileOverrides,
          reversed: false, startRatio: 0.7746478873239436,
          laps: 2, seconds: 110,
        })
        results.push({ label: strategy.label + '/seed' + seed, difficulty: 'hard',
          blue: run.vehicles.find(vehicle => vehicle.car === 'blue'),
          blueRecoveries: run.issues.filter(issue => issue.vehicleId === run.vehicles.find(vehicle => vehicle.car === 'blue')?.vehicleId && issue.code === 'recovery')
            .map(issue => ({ time: issue.time, index: issue.pathIndex, detail: issue.detail })) })
      }
  }
  for (const seed of [1, 4331]) {
      const run = runLaneCheck({
        path, trackName: 'Roundabout', seed, difficulty: 'normal',
        mode: 'traffic', car: 'red', handling: 'arcade',
          gridPositions: replayGrid,
        reversed: false, startRatio: 0.7746478873239436,
        laps: 2, seconds: 110,
      })
      const blue = run.vehicles.find(vehicle => vehicle.car === 'blue')
      results.push({ label: 'normal/seed' + seed, difficulty: 'normal', blue,
        blueRecoveries: run.issues.filter(issue => issue.vehicleId === blue?.vehicleId && issue.code === 'recovery')
          .map(issue => ({ time: issue.time, index: issue.pathIndex, detail: issue.detail })) })
  }
  console.log('AI_ROUNDABOUT_SWEEP ' + JSON.stringify(results))
  expect(results.length).toBe(cases.length * 2 + 2)
}, 120_000)

/**
 * Opt-in diagnostic on the real creator track and physical starting grid.
 * On Hard, Red/Red/Blue/Green race in the exported replay; switching the
 * simulated player to Yellow includes Yellow as an AI-driven fourth chassis.
 */
profileSweep('measures all four colors and sweeps Red through the western hairpin', () => {
  const original = CAR_DRIVING_PROFILES.red
  const cases: readonly { label: string, changes: Partial<CarDrivingProfile> }[] = [
    { label: 'current', changes: {  } },
    { label: 'reserve0.04', changes: { hardCornerReserve: 0.04 } },
    { label: 'reserve0.07', changes: { hardCornerReserve: 0.07 } },
    { label: 'reserve0.1', changes: { hardCornerReserve: 0.1 } },
    { label: 'reserve0.14', changes: { hardCornerReserve: 0.14 } },
    { label: 'reserve0.18', changes: { hardCornerReserve: 0.18 } },
    { label: 'reserve0.22', changes: { hardCornerReserve: 0.22 } },
    { label: 'reserve0-bonus0', changes: { hardCornerReserve: 0, hardCornerTargetBonus: 0 } },
    { label: 'reserve0.02-bonus0', changes: { hardCornerReserve: 0.02, hardCornerTargetBonus: 0 } },
    { label: 'reserve0.04-bonus0', changes: { hardCornerReserve: 0.04, hardCornerTargetBonus: 0 } },
    { label: 'reserve0.07-bonus0', changes: { hardCornerReserve: 0.07, hardCornerTargetBonus: 0 } },
    { label: 'reserve0.1-bonus0', changes: { hardCornerReserve: 0.1, hardCornerTargetBonus: 0 } },
    { label: 'preview6-reserve07', changes: { hardCornerReserve: 0.07, hardLookAheadSamples: 6 } },
    { label: 'preview8-reserve07', changes: { hardCornerReserve: 0.07, hardLookAheadSamples: 8 } },
    { label: 'preview12-reserve07', changes: { hardCornerReserve: 0.07, hardLookAheadSamples: 12 } },
    { label: 'preview14-reserve07', changes: { hardCornerReserve: 0.07, hardLookAheadSamples: 14 } },
    { label: 'preview16-reserve07', changes: { hardCornerReserve: 0.07, hardLookAheadSamples: 16 } },
    { label: 'preview20-reserve07', changes: { hardCornerReserve: 0.07, hardLookAheadSamples: 20 } },
    { label: 'gain1.9-reserve07', changes: { hardCornerReserve: 0.07, hardSteerGain: 1.9 } },
    { label: 'gain2.05-reserve07', changes: { hardCornerReserve: 0.07, hardSteerGain: 2.05 } },
    { label: 'gain2.35-reserve07', changes: { hardCornerReserve: 0.07, hardSteerGain: 2.35 } },
    { label: 'gain2.5-reserve07', changes: { hardCornerReserve: 0.07, hardSteerGain: 2.5 } },
    { label: 'gain2.7-reserve07', changes: { hardCornerReserve: 0.07, hardSteerGain: 2.7 } },
    { label: 'reaction6-reserve07', changes: { hardCornerReserve: 0.07, hardReaction: 6 } },
    { label: 'reaction8-reserve07', changes: { hardCornerReserve: 0.07, hardReaction: 8 } },
    { label: 'reaction10-reserve07', changes: { hardCornerReserve: 0.07, hardReaction: 10 } },
    { label: 'reaction14-reserve07', changes: { hardCornerReserve: 0.07, hardReaction: 14 } },
    { label: 'reaction16-reserve07', changes: { hardCornerReserve: 0.07, hardReaction: 16 } },
  ]
  const results: unknown[] = []
  const run = (car: CarId, aiProfileOverrides?: Readonly<Partial<Record<CarId, CarDrivingProfile>>>) => runLaneCheck({
    path, trackName: 'Roundabout', seed: 1, difficulty: 'hard',
    mode: 'traffic', car, handling: 'arcade',
    gridPositions: replayGrid,
    ...(aiProfileOverrides ? { aiProfileOverrides } : {}),
    reversed: false, startRatio: 0.7746478873239436,
    laps: 2, seconds: 110,
  })
  for (const { label, changes } of cases) {
      const simulation = run('red', { red: { ...original, ...changes } })
      results.push({
        label,
        vehicles: simulation.vehicles.map(v => ({
          car: v.car, id: v.vehicleId, time: v.finishedAt,
          recoveries: v.recoveries, offroad: v.offRoadSeconds,
          maxLaneError: v.maxLaneError,
        })),
        recoveries: simulation.issues
          .filter(issue => issue.code === 'recovery')
          .map(issue => ({ id: issue.vehicleId, time: issue.time, index: issue.pathIndex })),
      })
  }
  const yellow = run('yellow')
    results.push({
      label: 'yellow-grid',
      vehicles: yellow.vehicles.map(v => ({
        car: v.car, id: v.vehicleId, time: v.finishedAt,
        recoveries: v.recoveries, offroad: v.offRoadSeconds,
        maxLaneError: v.maxLaneError,
      })),
      recoveries: yellow.issues
        .filter(issue => issue.code === 'recovery')
        .map(issue => ({ id: issue.vehicleId, time: issue.time, index: issue.pathIndex })),
    })
  console.log('AI_RED_ROUNDABOUT_SWEEP ' + JSON.stringify(results))
  expect(results.length).toBe(cases.length + 1)
}, 180_000)


// Opt-in comparison of the proposed *individual* Hard driving profiles in
// two real exported physical grids. Do not accept a fast solo lap if it adds
// hairpin recoveries in traffic or makes another car slower.
profileSweep('compares four-car Hard candidates on both replay starting grids', () => {
  const carIds = ['red', 'blue', 'green', 'yellow'] as const
  const originals: Readonly<Record<CarId, CarDrivingProfile>> = CAR_DRIVING_PROFILES
  const candidates: readonly {
    label: string
    changes: Partial<Record<CarId, Partial<CarDrivingProfile>>>
  }[] = [
    { label: 'current', changes: {} },
    { label: 'red-reserve018', changes: { red: { hardCornerReserve: 0.18 } } },
    { label: 'red-reserve022', changes: { red: { hardCornerReserve: 0.22 } } },
    { label: 'red-hairpin010', changes: { red: { hardHairpinReserve: 0.1 } } },
    { label: 'red-hairpin016', changes: { red: { hardHairpinReserve: 0.16 } } },
    { label: 'red-hairpin022', changes: { red: { hardHairpinReserve: 0.22 } } },
    { label: 'red-hairpin028', changes: { red: { hardHairpinReserve: 0.28 } } },
    { label: 'blue-edge01-corner004', changes: {
      blue: { hardEdgeAvoidanceScale: 0.1, hardCornerTargetBonus: 0.04 },
    } },
    { label: 'blue-reaction10-gain242-preview10', changes: {
      blue: { hardReaction: 10, hardSteerGain: 2.42, hardLookAheadSamples: 10 },
    } },
    { label: 'blue-edge0-corner006', changes: {
      blue: { hardEdgeAvoidanceScale: 0, hardCornerTargetBonus: 0.06 },
    } },
    { label: 'green-reaction12', changes: { green: { hardReaction: 12 } } },
    { label: 'yellow-gain3-preview12', changes: {
      yellow: { hardSteerGain: 3, hardLookAheadSamples: 12 },
    } },
    { label: 'combined-safe-candidates', changes: {
      red: { hardCornerReserve: 0.22 },
      blue: { hardEdgeAvoidanceScale: 0, hardCornerTargetBonus: 0.06 },
      green: { hardReaction: 12 },
      yellow: { hardSteerGain: 3, hardLookAheadSamples: 12 },
    } },
  ]
  const situations = [
    { grid: [2, 1, 0, 3], car: 'red' },
    { grid: [2, 3, 1, 0], car: 'red' },
    { grid: [2, 3, 1, 0], car: 'yellow' },
  ] as const
  const outcomes: unknown[] = []
  for (const candidate of candidates) {
    const aiProfileOverrides: Partial<Record<CarId, CarDrivingProfile>> = {}
    for (const car of carIds) {
      const changes = candidate.changes[car]
      if (changes) aiProfileOverrides[car] = { ...originals[car], ...changes }
    }
    for (const situation of situations) {
        for (const seed of [1, 4331]) {
          const run = runLaneCheck({
            path, trackName: 'Roundabout', seed, difficulty: 'hard',
            mode: 'traffic', car: situation.car, handling: 'arcade',
            gridPositions: situation.grid,
            aiProfileOverrides,
            reversed: false, startRatio: 0.7746478873239436,
            laps: 2, seconds: 110,
          })
          outcomes.push({
            label: candidate.label, grid: situation.grid, player: situation.car,
            seed, stopped: run.stoppedReason,
            cars: run.vehicles.map(vehicle => ({
              id: vehicle.vehicleId, car: vehicle.car,
              time: vehicle.finishedAt, recoveries: vehicle.recoveries,
              offroad: Number(vehicle.offRoadSeconds.toFixed(3)),
            })),
          })
        }
      }
  }
  console.log('AI_HARD_CROSS_TRACK_CANDIDATES ' + JSON.stringify(outcomes))
  expect(outcomes).toHaveLength(candidates.length * situations.length * 2)
}, 180_000)
