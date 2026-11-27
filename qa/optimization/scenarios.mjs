/** Fixed study scenarios; names are QA metadata, not production AI rules. */
export const STUDY_SCENARIOS = [
  {
    id: 'desert-reverse', file: 'tests/fixtures/desertSandAi.trackforge.json',
    reverse: true, startRatio: 0.7794871794871795,
    laps: 2, seconds: 70, gridPositions: [1, 3, 0, 2],
    group: 'calibration',
  },
  {
    id: 'pine-hairpins', file: 'tests/fixtures/pineHairpinsAi.trackforge.json',
    reverse: false, startRatio: 0,
    laps: 1, seconds: 80, group: 'calibration',
  },
  {
    // Geometry and start grid from the 2026-11-23 Figure-eight replay.
    // All four cars compete in separate trials; the live Hard grid mirrors
    // Green and therefore does not include Yellow.
    id: 'figure-eight-replay', file: 'tests/fixtures/figureEightRaceAi.trackforge.json',
    reverse: false, startRatio: 0.32853982300884954,
    laps: 2, seconds: 100, gridPositions: [0, 2, 3, 1],
    group: 'calibration',
  },
  {
    id: 'kids-room', file: 'tests/fixtures/kidsRoomAi.trackforge.json',
    reverse: false, startRatio: 0.21932299012693934,
    laps: 2, seconds: 145, group: 'validation',
  },
  {
    id: 'meadow-loop', file: 'tests/fixtures/meadowLoopAi.trackforge.json',
    reverse: false, startRatio: 0,
    laps: 2, seconds: 70, group: 'validation',
  },
  {
    id: 'emile', file: 'tests/fixtures/emile.trackforge.json',
    reverse: false, startRatio: 0,
    laps: 2, seconds: 120, group: 'validation',
  },
]

// Opt-in only: the matched legacy-physics comparison must never feed new
// jump geometry to an older engine that cannot represent it.
const jumpLayout = (id, surface, rampLength, group) => ({
  id, group, reverse: false, startRatio: 0, laps: 2, seconds: 85,
  track: {
    id, name: id, version: 8,
    points: [
      [-500, -300], [-250, -300], [-100, -300], [-100 + rampLength, -300],
      [400, -300], [520, -180], [520, 180], [400, 300],
      [0, 300], [-400, 300], [-520, 180], [-520, -180], [-500, -300],
    ].map(([x, y], index) => ({
      x, y, surface, id: id + '-' + index,
      ...(index === 2 ? { structure: 'jump' } : {}),
    })),
    trees: [], terrain: { cellSize: 32, cells: [] },
    start: { ratio: 0, reversed: false },
    recoveryCheckpoints: [0.25, 0.5, 0.75],
    lighting: 'day', createdAt: 1, updatedAt: 1,
  },
})

export const JUMP_STUDY_SCENARIOS = [
  jumpLayout('jump-straight', 'street', 110, 'calibration'),
  jumpLayout('jump-gravel', 'dirt', 160, 'validation'),
]

export function selectScenarios(ids, available = STUDY_SCENARIOS) {
  const requested = ids?.length ? ids : available.map(x => x.id)
  const selected = requested.map(id => {
    const found = available.find(x => x.id === id) ??
      (available === STUDY_SCENARIOS ? JUMP_STUDY_SCENARIOS.find(x => x.id === id) : undefined)
    if (!found) throw new Error(`Unknown scenario: ${id}`)
    return found
  })
  if (new Set(selected.map(x => x.id)).size !== selected.length)
    throw new Error('Duplicate scenario')
  return selected
}

// Identical control points across surfaces isolate the effect of road grip.
// The fast course has long straights and broad turns; the technical course
// adds a sequence of tighter bends without crossings.
const BALANCE_LAYOUTS = {
  fast: [
    [-320, -180], [0, -180], [320, -180], [410, -120],
    [410, 120], [320, 180], [0, 180], [-320, 180],
    [-410, 120], [-410, -120], [-320, -180],
  ],
  technical: [
    [-300, -210], [0, -210], [260, -210], [320, -150],
    [260, -90], [40, -90], [-40, -30], [40, 30],
    [260, 30], [320, 90], [260, 150], [0, 150],
    [-300, 150], [-360, 90], [-360, -150], [-300, -210],
  ],
}

export const BALANCE_SCENARIOS = Object.entries(BALANCE_LAYOUTS).flatMap(([layout, points]) =>
  ['street', 'dirt', 'ice'].map(surface => {
    const id = `balance-${layout}-${surface}`
    const scale = layout === 'fast' ? 1.8 : 1
    return {
      id, layout, surface, startRatio: 0, reverse: false, laps: 2, seconds: 100,
      track: {
        id, name: id, version: 8,
        points: points.map(([x, y], index) => ({
          x: x * scale, y: y * scale, surface, id: `${layout}-${index}`,
        })),
        trees: [], terrain: { cellSize: 32, cells: [] },
        start: { ratio: 0, reversed: false },
        recoveryCheckpoints: [0.25, 0.5, 0.75],
        lighting: 'day', createdAt: 1, updatedAt: 1,
      },
    }
  }),
)
