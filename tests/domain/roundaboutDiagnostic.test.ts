// @vitest-environment node
// Diagnostic-only reproduction of the uploaded Roundabout.trackforge.json.
// Road controls and all 6,512 terrain cells retained losslessly via row ranges.
// Remove this high-cost integration test after reporting the finding.
import { it, expect } from 'vitest'
import { buildRoadPath } from '@/domain/track/pathBuilder'
import { runLaneCheck } from '../../qa/lanes/simulation'
import type { TerrainCell } from '@/domain/model'

const hill = "-14,-23,-20;-14,-13,-7;-13,-42,-39;-13,-29,-4;-12,-44,-37;-12,-31,0;-11,-44,-37;-11,-32,4;-10,-45,-36;-10,-33,7;-9,-45,12;-8,-45,16;-7,-45,19;-6,-44,26;-5,-44,35;-5,37,42;-4,-43,43;-3,-43,43;-2,-42,44;-1,-41,44;0,-40,44;1,-39,44;2,-39,43;3,-37,43;4,-36,43;5,-35,43;6,-34,43;7,-33,42;8,-31,42;9,-29,41;10,-27,40;11,-25,38;12,-23,35;13,-20,23;14,-17,21;15,-14,19;16,-9,16;17,-3,9;22,-45,-43;23,-46,-42;24,-47,-41;25,-49,-41;26,-50,-42;27,-51,-42;27,49,51;28,-52,-43;28,48,52;29,-53,-45;29,47,53;30,-53,-47;30,46,53;31,-53,-48;31,45,52;32,-53,-48;32,45,51;33,-54,-49;33,44,50;34,-54,-49;34,42,49;35,-54,-49;35,41,49;36,-54,-49;36,39,48;37,-54,-44;37,34,47;38,-54,-43;38,32,46;39,-53,-43;39,32,45;40,-53,-43;40,31,43;41,-52,-43;41,31,42;42,-48,-44;42,32,39;43,33,34;53,66,70;54,-16,0;54,65,71;55,-20,4;55,13,17;55,64,72;56,-23,7;56,12,18;56,64,72;57,-27,19;57,63,72;58,-29,20;58,62,72;59,-31,22;59,60,72;60,-35,25;60,59,72;61,-42,28;61,58,72;62,-52,30;62,57,71;63,-57,31;63,41,46;63,55,70;64,-60,47;64,53,70;65,-61,69;66,-62,68;67,-62,67;68,-69,66;69,-70,65;70,-71,63;71,-71,62;72,-71,61;73,-72,60;74,-71,59;75,-71,58;76,-70,57;77,-69,55;78,-68,53;79,-67,50;80,-65,14;80,17,48;81,-64,14;81,21,45;82,-62,14;82,30,36;83,-61,14;84,-61,14;85,-61,13;86,-61,13;87,-60,12;88,-60,11;89,-60,10;90,-59,8;91,-59,5;92,-58,3;93,-57,1;94,-56,-17;94,-14,-1;95,-55,-18;95,-13,-4;96,-54,-18;96,-10,-8;97,-52,-18;98,-50,-31;98,-27,-18;99,-46,-36;99,-26,-18;100,-25,-19;101,-24,-20"
const water = "27,-41,-37;28,-42,-36;29,-44,-35;30,-46,-35;31,-47,-35;32,-47,-35;33,-48,-35;34,-48,-34;35,-48,-34;36,-48,-35;37,-43,-36;38,-42,-38;39,-42,-41"
const points = [[-1645.4183388555584,434.86606214953736],[-193.08700282657753,789.1674828056284],[979.9131588845556,743.7544740135058],[1787.161777918077,684.3247322140742],[2055.013943810501,991.2207569640836],[2062.795711541466,1331.2966429472626],[1913.5560656075263,1623.881547363696],[1016.5811713340021,1626.5917631615453],[48.31270891899453,1241.5936840754061],[-840.9687523851799,1370.9640490474658],[-1904.9992401239774,1661.8454196948805],[-2011.9199535524717,935.2180498889319],[-1593.718084182229,428.335727062393]]
function expand(kind: 'hill' | 'water', spans: string): TerrainCell[] {
  return spans.split(';').flatMap(span => {
    const [row, start, end] = span.split(',').map(Number)
    if (row === undefined || start === undefined || end === undefined) throw Error('Bad source terrain')
    return Array.from({ length: end - start + 1 }, (_, index) => ({
      kind, row, column: start + index,
    }))
  })
}

it('diagnoses Green on the uploaded Roundabout 2-lap Hard arcade race', () => {
  const path = buildRoadPath(points.map(([x, y], i) => ({
    x: x!, y: y!, surface: 'street' as const, curve: 'smooth' as const, tension: 0.5,
    structure: 'surface' as const, id: 'point-' + i,
  })), { cellSize: 32, cells: [...expand('hill', hill), ...expand('water', water)] })
  const run = runLaneCheck({
    path, trackName: 'Roundabout', seed: 1, difficulty: 'hard',
    mode: 'traffic', car: 'red', handling: 'arcade',
    reversed: false, startRatio: 0.7746478873239436,
    laps: 2, seconds: 110,
  })
  const issues = run.issues.filter(issue => issue.vehicleId === 'ai-3')
  const cornerSamples = run.samples.filter(sample => ['ai-1', 'ai-2', 'ai-3'].includes(sample.vehicleId) &&
    ((sample.time >= 2.5 && sample.time <= 6.1) ||
      (sample.time >= 37.5 && sample.time <= 41.2)))
  console.info('ROUNDABOUT_CORNER', JSON.stringify(cornerSamples))
  console.info('ROUNDABOUT_RESULT', JSON.stringify({
    pathLength: path.totalLength, stoppedReason: run.stoppedReason,
    vehicles: run.vehicles,
    greenIssues: issues,
    greenLateSamples: run.samples.filter(sample => sample.vehicleId === 'ai-3').slice(-8),
    issueCounts: run.issues.reduce((counts, issue) => {
      const key = issue.vehicleId + '/' + issue.code
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {} as Record<string, number>),
  }))
  expect(run.vehicles).toHaveLength(4)
  expect(run.stoppedReason).not.toBe('invalid-state')
}, 120000)
