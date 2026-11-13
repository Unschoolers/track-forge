import { asTrackId, type SurfaceId, type Track, type TrackPoint } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'

function circuit(id: string, name: string, coordinates: readonly (readonly [number, number])[], surfaces: readonly SurfaceId[] = [], bridge = -1): Track {
  const points: TrackPoint[] = coordinates.map(([x, y], index) => ({
    x, y, id: `${id}-${index}`, surface: surfaces[index] ?? 'street',
    curve: 'smooth', tension: 0.5,
    ...(index === bridge ? { structure: 'overpass' as const } : {}),
  }))
  const treesByCircuit: Record<string, readonly { x: number; y: number }[]> = {
    'official-meadow': [{ x: -520, y: -280 }, { x: -480, y: -320 }, { x: 500, y: 300 }],
    'official-hairpin': [{ x: -850, y: -550 }, { x: -790, y: -600 }, { x: -730, y: -550 }, { x: 800, y: 640 }, { x: 850, y: 690 }],
    'official-frost': [{ x: -540, y: 320 }, { x: -500, y: 370 }, { x: 530, y: -330 }, { x: 570, y: -380 }],
    'official-bridge': [{ x: -530, y: -360 }, { x: 530, y: -350 }, { x: 520, y: 380 }, { x: 570, y: 420 }],
    'official-quarry': [{ x: 540, y: -100 }, { x: 590, y: -40 }, { x: -290, y: 183 }, { x: -560, y: -160 }],
    'official-switchback': [{ x: 600, y: 155 }, { x: 650, y: 250 }, { x: -485, y: 115 }, { x: -590, y: -245 }],
  }
  return { ...createStarterTrack(asTrackId(id), 0), name, points, trees: treesByCircuit[id] ?? [] }
}

export const OFFICIAL_CIRCUITS = [
  { track: circuit('official-meadow', 'Meadow Loop', [[-340,-180],[0,-210],[340,-180],[420,-70],[420,100],[310,200],[0,220],[-310,200],[-420,100],[-420,-70],[-340,-180]]), target: 15 },
  { track: circuit('official-hairpin', 'Pine Hairpins', [[-720,-432],[0,-432],[576,-432],[720,-288],[576,-144],[0,-144],[-288,-144],[-432,0],[-288,144],[288,144],[576,288],[576,576],[-520,576],[-670,536],[-720,376],[-720,192],[-720,-192],[-720,-432]]), target: 40 },
  { track: circuit('official-frost', 'Frost and Dust', [[-350,-210],[0,-240],[350,-210],[430,-80],[430,110],[320,230],[0,250],[-320,230],[-430,110],[-430,-80],[-350,-210]], ['ice','street','street','street','street','dirt','street','street','street','street','street']), target: 17 },
  { track: circuit('official-bridge', 'High Crossing', [[-330,-230],[0,-260],[330,-230],[400,-90],[400,120],[300,250],[0,280],[-300,250],[-400,120],[-400,-90],[-330,-230]], [], 2), target: 18 },
  {
    track: circuit('official-quarry', 'Quarry Run', [
      [0, -320], [420, -320], [615, -285], [745, -175], [775, -10],
      [725, 155], [590, 285], [410, 320], [245, 255], [120, 145],
      [-65, 115], [-245, 195], [-430, 285], [-610, 225],
      [-725, 90], [-750, -90], [-680, -235], [-490, -320], [0, -320],
    ]),
    target: 22,
  },
  {
    track: circuit('official-switchback', 'Switchback Viaduct', [
      [-680, -305], [-480, -260], [-210, -125], [210, 125], [470, 270],
      [650, 250], [765, 125], [780, -55], [690, -230], [530, -310],
      [350, -300], [155, -210], [-365, 330], [-545, 365],
      [-700, 305], [-810, 165], [-845, -25], [-820, -200], [-680, -305],
    ], [], 2),
    target: 26,
  },
] as const
