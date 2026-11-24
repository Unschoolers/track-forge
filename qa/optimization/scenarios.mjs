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

export function selectScenarios(ids, available = STUDY_SCENARIOS) {
  const requested = ids?.length ? ids : available.map(x => x.id)
  const selected = requested.map(id => {
    const found = available.find(x => x.id === id)
    if (!found) throw new Error(`Unknown scenario: ${id}`)
    return found
  })
  if (new Set(selected.map(x => x.id)).size !== selected.length)
    throw new Error('Duplicate scenario')
  return selected
}
