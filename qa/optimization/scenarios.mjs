/** Fixed study scenarios; names are QA metadata, not production AI rules. */
export const STUDY_SCENARIOS = [
  {
    id: 'desert-reverse', file: 'tests/fixtures/desertSandAi.trackforge.json',
    reverse: true, startRatio: 0.7794871794871795,
    laps: 2, seconds: 70, gridPositions: [1, 3, 0, 2],
    group: 'calibration',
  },
  {
    id: 'pine-hairpins', officialName: 'Pine Hairpins',
    reverse: false, startRatio: 0,
    laps: 1, seconds: 80, group: 'calibration',
  },
  {
    id: 'kids-room', file: 'tests/fixtures/kidsRoomAi.trackforge.json',
    reverse: false, startRatio: 0.21932299012693934,
    laps: 2, seconds: 145, group: 'validation',
  },
  {
    id: 'meadow-loop', officialName: 'Meadow Loop',
    reverse: false, startRatio: 0,
    laps: 2, seconds: 70, group: 'validation',
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

/** Choose representative calibration circuits while retaining holdout tracks.
 * All other selected circuits remain independent validation scenarios.
 */
export function selectCalibration(ids, scenarios = STUDY_SCENARIOS) {
  const picked = ids?.length
    ? selectScenarios(ids, scenarios)
    : scenarios.filter(scenario => scenario.group === 'calibration')
  if (picked.length < 2) throw new Error('Choose at least two calibration circuits')
  if (picked.length >= scenarios.length)
    throw new Error('At least one independent holdout circuit is required')
  return picked
}
