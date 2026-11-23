/** Bounded offline passing decisions. Steering/line search is separate. */
const ALTERNATIVES = {
  triggerDistanceScale: [0.85, 0.95, 1.1, 1.2],
  passSpeedAdvantage: [-2, 2, 5, 8],
  abandonAfterSeconds: [4, 5.5, 6.5, 10],
  rejoinClearSeconds: [0.3, 0.4],
}

export function generatePassingCandidates(car, baseline, count) {
  if (!['red', 'green', 'blue', 'yellow'].includes(car))
    throw new Error(`Unknown car: ${car}`)
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new Error('Candidates per car must be 1..100')
  const result = []
  const seen = new Set()
  const add = changes => {
    const changed = Object.fromEntries(
      Object.entries(changes).filter(([key, value]) => baseline[key] !== value),
    )
    const signature = JSON.stringify(changed)
    if (Object.keys(changed).length === 0 || seen.has(signature)) return
    seen.add(signature)
    result.push({ id: `pass-${car}-${result.length + 1}`, car, changes: changed })
  }
  for (const [key, values] of Object.entries(ALTERNATIVES)) {
    for (const value of values) add({ [key]: value })
  }
  const singles = [...result]
  for (let i = 0; result.length < count && i < count * 8; i++) {
    const a = singles[i % singles.length]
    const b = singles[(i * 7 + 5) % singles.length]
    if (a && b) add({ ...a.changes, ...b.changes })
  }
  return result.slice(0, count)
}
