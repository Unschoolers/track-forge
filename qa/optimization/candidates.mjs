/** Offline bounded, reproducible search of driving-policy parameters only.
 * Never mutate CAR_SPECS, tire grip, engine acceleration, road or physics.
 */
const BOUNDS = {
  hardCornerTargetBonus: [0, 0.8],
  hardLookAheadSamples: [3, 20],
  hardSteerGain: [1.6, 3.6],
  hardReaction: [4, 18],
  hardCornerReserve: [0, 0.1],
  hardEdgeAvoidanceScale: [0, 1],
}

const DELTAS = {
  red: {
    hardCornerTargetBonus: [-0.05, 0.04, 0.09],
    hardLookAheadSamples: [-3, 2, 4],
    hardSteerGain: [-0.2, 0.2],
    hardCornerReserve: [-0.01, 0.02],
  },
  green: {
    hardEdgeAvoidanceScale: [-0.1, -0.15, -0.2, 0.1],
    hardCornerTargetBonus: [-0.1, -0.05, 0.05],
    hardSteerGain: [-0.3, 0.2],
    hardLookAheadSamples: [-2, 2],
  },
  blue: {
    hardCornerTargetBonus: [-0.03, 0.04, 0.07, 0.11],
    hardLookAheadSamples: [-2, 2, 4],
    hardSteerGain: [-0.12, 0.18],
    hardEdgeAvoidanceScale: [-0.1, 0.1],
  },
  yellow: {
    hardCornerTargetBonus: [-0.1, -0.2, -0.3, -0.35],
    hardLookAheadSamples: [-3, 2, 4],
    hardSteerGain: [-0.3, 0.2],
    hardReaction: [-3, 2],
  },
}
function clamp(v, [min, max]) {
  return Math.min(max, Math.max(min, v))
}
function round(value) {
  return Math.round(value * 1000) / 1000
}
export function generateCandidates(car, baseline, count) {
  if (!DELTAS[car]) throw new Error(`Unknown car: ${car}`)
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new Error('Candidates per car must be 1..100')
  const proposals = []
  const seen = new Set()
  const add = changes => {
    const changed = Object.fromEntries(
      Object.entries(changes).filter(([key, val]) => val !== baseline[key]),
    )
    const signature = JSON.stringify(changed)
    if (!Object.keys(changed).length || seen.has(signature)) return
    seen.add(signature)
    proposals.push({ id: `${car}-${proposals.length + 1}`, car, changes: changed })
  }
  const deltas = DELTAS[car]
  for (const [key, values] of Object.entries(deltas)) {
    const existing = baseline[key] ?? 1
    for (const delta of values) {
      const raw = clamp(existing + delta, BOUNDS[key])
      const next = /Samples|Reaction/.test(key) ? Math.round(raw) : round(raw)
      add({ [key]: next })
    }
  }
  // Deterministic pairwise refinement, rather than a combinatorial grid.
  let index = 0
  const singles = [...proposals]
  while (proposals.length < count && index < count * 8) {
    const a = singles[index % singles.length]
    const b = singles[(index * 5 + 7) % singles.length]
    if (a && b) add({ ...a.changes, ...b.changes })
    index++
  }
  return proposals.slice(0, count)
}

export const DEFAULT_CARS = ['red', 'green', 'blue', 'yellow']
