import { createHash } from 'node:crypto'

function assert(valid, reason) {
  if (!valid) throw new Error('Invalid Track Forge export: ' + reason)
}
const finite = (n) => typeof n === 'number' && Number.isFinite(n)
const round = (n) => Math.round(n * 1000) / 1000
const identity = (v) => (v.player ? 'player' : 'AI') + ':' + v.car

/** Geometry + terrain identity, independent of track name and decoration. */
export function trackFingerprint(exported) {
  const track = exported?.track
  assert(track && Array.isArray(track.points), 'track.points is missing')
  const points = track.points.map((p) =>
    [p.x, p.y, p.surface, p.curve, p.tension, p.structure])
  const cells = (track.terrain?.cells ?? []).map((c) => [c.kind, c.row, c.column])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[2] - b[2])
  return createHash('sha256').update(JSON.stringify({
    points, cellSize: track.terrain?.cellSize ?? null, cells,
    routeKind: track.routeKind ?? 'circuit',
  })).digest('hex').slice(0, 16)
}

export function summarizeTrack(exported) {
  const track = exported?.track
  assert(track && Array.isArray(track.points) && track.points.length, 'missing road control points')
  assert(track.points.every((p) => finite(p.x) && finite(p.y)), 'non-finite road control point')
  const counts = (items) => items.reduce((acc, v) => {
    const key = String(v ?? 'unknown')
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  const points = track.points
  return {
    name: track.name ?? 'Unnamed', version: track.version ?? null,
    fingerprint: trackFingerprint(exported), routeKind: track.routeKind ?? 'circuit',
    points: points.length, pointSurfaces: counts(points.map((p) => p.surface)),
    structures: counts(points.map((p) => p.structure)),
    terrainCells: counts((track.terrain?.cells ?? []).map((c) => c.kind)),
    checkpoints: track.recoveryCheckpoints?.length ?? 0,
    scenery: track.scenery?.length ?? 0,
    bounds: {
      minX: Math.min(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxX: Math.max(...points.map((p) => p.x)),
      maxY: Math.max(...points.map((p) => p.y)),
    },
  }
}

/** Independent of lap number: bucket exact-tick incident locations by road sample. */
export function groupHotspots(events, binSize = 50) {
  assert(Number.isInteger(binSize) && binSize > 0, 'hotspotBin must be positive')
  const groups = new Map()
  const interesting = new Set([
    'curb-hit', 'vehicle-recovered', 'collision', 'barrier-collision', 'surface-changed',
  ])
  for (const event of events) {
    if (!interesting.has(event.type)) continue
    const bin = Math.floor(event.pathIndex / binSize)
    const key = event.id + ':' + bin
    const group = groups.get(key) ?? {
      id: event.id, car: event.car, pathIndexFrom: bin * binSize,
      pathIndexTo: (bin + 1) * binSize - 1, counts: {}, times: [],
    }
    group.counts[event.type] = (group.counts[event.type] ?? 0) + 1
    group.times.push(event.time)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) =>
    10 * ((b.counts['vehicle-recovered'] ?? 0) - (a.counts['vehicle-recovered'] ?? 0)) +
    (b.counts['curb-hit'] ?? 0) - (a.counts['curb-hit'] ?? 0)).slice(0, 20)
}

/**
 * Time-weighted telemetry stats, defaulting to the player's finish.
 * Never invent an AI finish time when the export ends before AI finishes.
 * Events use exact ticks; telemetry is sampled at the export's frame interval.
 */
export function summarizeRace(exported, options = {}) {
  assert(exported?.format === 'trackforge-race-replay', 'expected trackforge-race-replay')
  assert(exported.formatVersion === 1, 'unsupported race formatVersion')
  assert(Array.isArray(exported.frames) && exported.frames.length > 0, 'missing frames')
  assert(Array.isArray(exported.events), 'missing events')
  const frames = exported.frames
  const last = frames.at(-1).t
  const end = options.full ? last : Math.min(last, exported.result?.playerTime ?? last)
  assert(finite(end) && end > 0, 'invalid observation end')
  const statsById = new Map()
  for (const v of frames[0].vehicles ?? []) {
    assert(typeof v.id === 'string' && typeof v.car === 'string', 'invalid vehicle')
    assert(!statsById.has(v.id), 'duplicate vehicle')
    statsById.set(v.id, {
      id: v.id, car: v.car, player: v.player === true,
      seconds: 0, speedIntegral: 0, maxSpeed: 0, brake: 0, grass: 0,
      curb: 0, highSlip: 0, steeringSaturation: 0, steeringReversals: 0,
      lastStrongSteer: null, surfaces: {}, events: {}, recoveries: [], gates: [],
    })
  }
  assert(statsById.size > 0, 'no vehicles')
  for (let i = 0; i < frames.length - 1; i++) {
    const frame = frames[i], next = frames[i + 1]
    assert(finite(frame.t) && finite(next.t) && next.t >= frame.t,
      'nonmonotonic telemetry at frame ' + i)
    const dt = Math.max(0, Math.min(next.t, end) - Math.min(frame.t, end))
    if (!dt) continue
    for (const v of frame.vehicles ?? []) {
      const s = statsById.get(v.id)
      if (!s || !finite(v.speed) || (v.finishedAt !== null && v.finishedAt <= frame.t)) continue
      s.seconds += dt
      s.speedIntegral += v.speed * dt
      s.maxSpeed = Math.max(s.maxSpeed, v.speed)
      if (v.braking) s.brake += dt
      if (v.currentSurface === 'grass') s.grass += dt
      if (v.onCurb) s.curb += dt
      if (finite(v.slip) && Math.abs(v.slip) > 0.12) s.highSlip += dt
      const surface = v.currentSurface ?? 'unknown'
      const part = s.surfaces[surface] ?? { seconds: 0, speedIntegral: 0 }
      part.seconds += dt
      part.speedIntegral += v.speed * dt
      s.surfaces[surface] = part
      if (finite(v.ai?.steer)) {
        const steer = v.ai.steer
        if (Math.abs(steer) >= 0.9) s.steeringSaturation += dt
        if (Math.abs(steer) >= 0.7) {
          const prior = s.lastStrongSteer
          if (prior && Math.sign(prior.value) !== Math.sign(steer) &&
              frame.t - prior.t <= 0.35) s.steeringReversals++
          s.lastStrongSteer = { t: frame.t, value: steer }
        }
      }
    }
  }
  const locations = []
  let frameIndex = 0
  for (const item of [...exported.events].sort((a, b) => a.t - b.t)) {
    if (!finite(item.t) || item.t > end) continue
    const event = item.event
    if (!event || typeof event.type !== 'string') continue
    while (frameIndex + 1 < frames.length && frames[frameIndex + 1].t <= item.t) frameIndex++
    const s = statsById.get(event.vehicleId)
    if (!s) continue
    s.events[event.type] = (s.events[event.type] ?? 0) + 1
    if (event.type === 'vehicle-recovered') {
      s.recoveries.push({
        time: round(item.t), reason: event.reason ?? 'unknown',
        pathIndex: event.pathIndex ?? null,
      })
    }
    if (event.type === 'gate-crossed') s.gates.push({
      lap: event.lap, gate: event.gate, time: round(event.time ?? item.t),
    })
    const sample = frames[frameIndex]?.vehicles?.find((v) => v.id === event.vehicleId)
    const pathIndex = event.pathIndex ?? sample?.pathIndex
    if (Number.isInteger(pathIndex)) locations.push({
      id: s.id, car: s.car, type: event.type,
      time: round(item.t), pathIndex,
    })
  }
  const standings = new Map((exported.result?.standings ?? []).map((v) => [v.id, v]))
  const vehicles = [...statsById.values()].map((s) => {
    const stand = standings.get(s.id)
    return {
      id: s.id, car: s.car, player: s.player,
      observedSeconds: round(s.seconds),
      averageSpeed: round(s.speedIntegral / Math.max(s.seconds, 1e-9)),
      maxSpeed: round(s.maxSpeed), brakingSeconds: round(s.brake),
      grassSeconds: round(s.grass), curbSeconds: round(s.curb),
      highSlipSeconds: round(s.highSlip),
      steeringSaturationSeconds: round(s.steeringSaturation),
      steeringReversals: s.steeringReversals,
      surfaces: Object.fromEntries(Object.entries(s.surfaces).map(([name, p]) =>
        [name, { seconds: round(p.seconds), meanSpeed: round(p.speedIntegral / p.seconds) }])),
      events: s.events, recoveries: s.recoveries, gates: s.gates,
      completedLaps: stand?.lap ?? null, finishTime: stand?.finishTime ?? null,
    }
  })
  return {
    track: summarizeTrack(exported), setup: exported.setup,
    observationEnd: round(end), observationType: options.full ? 'full-recording' : 'player-finish',
    droppedEvents: exported.droppedEvents ?? 0, vehicles,
    hotspots: groupHotspots(locations, options.hotspotBin ?? 50),
  }
}

/** Match by role/color (not AI grid slot); flag invalid comparisons explicitly. */
export function compareRaces(before, after) {
  const a = summarizeRace(before), b = summarizeRace(after)
  const warnings = []
  if (a.track.fingerprint !== b.track.fingerprint) warnings.push('Different track geometry/terrain')
  for (const key of ['difficulty', 'handling', 'laps', 'mode', 'car']) {
    if (a.setup?.[key] !== b.setup?.[key]) warnings.push('Different ' + key)
  }
  if (JSON.stringify(a.setup?.gridPositions) !== JSON.stringify(b.setup?.gridPositions))
    warnings.push('Different physical starting grid')
  const previous = new Map(a.vehicles.map((v) => [identity(v), v]))
  const comparisons = b.vehicles.flatMap((v) => {
    const old = previous.get(identity(v))
    if (!old) return []
    return [{
      id: v.id, car: v.car, player: v.player,
      averageSpeedDelta: round(v.averageSpeed - old.averageSpeed),
      brakeSecondsDelta: round(v.brakingSeconds - old.brakingSeconds),
      grassSecondsDelta: round(v.grassSeconds - old.grassSeconds),
      recoveriesBefore: old.recoveries.length, recoveriesAfter: v.recoveries.length,
      finishTimeBefore: old.finishTime, finishTimeAfter: v.finishTime,
    }]
  })
  return {
    warnings, first: { track: a.track.name, observed: a.observationEnd },
    second: { track: b.track.name, observed: b.observationEnd }, comparisons,
  }
}
