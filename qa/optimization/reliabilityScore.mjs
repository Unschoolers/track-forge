import { evaluatePair } from './score.mjs'

export function metrics(records) {
  const rows = records.flatMap(x => x.rows)
  return {
    dnf: rows.filter(x => x.finished_seconds === null).length,
    recoveries: rows.reduce((n, x) => n + x.recoveries, 0),
    errors: records.flatMap(x => x.events).filter(x => x.severity === 'error' && x.code !== 'recovery' && x.code !== 'timeout').length,
    seconds: rows.reduce((n, x) => n + (x.finished_seconds ?? 60), 0),
    offroad: rows.reduce((n, x) => n + x.offroad_seconds, 0),
  }
}

// Existing Hairpin debt may be reduced, not moved to another vehicle or race.
export function noNewDebt(before, after) {
  return before.length === after.length && before.every((old, i) => {
    const current = after[i]
    if (old.rows.length !== current.rows.length ||
        new Set(current.rows.map(x => x.vehicle_id)).size !== current.rows.length) return false
    if (current.events.some(x => x.severity === 'error' && x.code !== 'recovery' && x.code !== 'timeout')) return false
    for (const event of current.events.filter(x => x.severity === 'error')) {
      const row = current.rows.find(x => x.vehicle_id === event.vehicle_id)
      if (!row || (event.code === 'timeout' && row.finished_seconds !== null)) return false
    }
    return old.rows.every(row => {
      const next = current.rows.find(x => x.vehicle_id === row.vehicle_id)
      const recoveryEvents = current.events.filter(x => x.code === 'recovery' && x.severity === 'error' && x.vehicle_id === row.vehicle_id).length
      return next && next.car_type === row.car_type && next.recoveries <= row.recoveries &&
        recoveryEvents <= next.recoveries &&
        (row.finished_seconds === null || next.finished_seconds !== null)
    })
  })
}

// Re-focus each recorded driver in the same genuine race. No extra simulations
// are necessary to detect a slow or repeatedly recovered opponent.
export function crossTrackRegressions(before, after) {
  if (before.length !== after.length) throw new Error('Incomplete cross-track matrix')
  return after.flatMap((current, i) => current.rows.map(row => {
    const pair = evaluatePair({ ...before[i], focusVehicleId: row.vehicle_id },
      { ...current, focusVehicleId: row.vehicle_id })
    return { ...pair, vehicleId: row.vehicle_id }
  }).filter(x => !x.eligible))
}

export function compareReliability(a, b) {
  return a.errors - b.errors || a.dnf - b.dnf || a.recoveries - b.recoveries
}
export function compareResults(a, b) {
  return compareReliability(a.hairpin, b.hairpin) ||
    compareReliability(a.crossTrack, b.crossTrack) ||
    a.crossTrack.seconds - b.crossTrack.seconds ||
    a.hairpin.seconds - b.hairpin.seconds ||
    a.hairpin.offroad - b.hairpin.offroad
}
