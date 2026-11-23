// Run explicitly with node --test; avoid collecting Node tests with Vitest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareRaces, groupHotspots, summarizeRace, summarizeTrack, trackFingerprint,
} from './summary.mjs'

const track = () => ({
  format: 'trackforge-track',
  track: {
    name: 'Hairpins', version: 8, points: [
      { x: 0, y: 0, surface: 'street', curve: 'smooth', tension: 0.5, structure: 'surface' },
      { x: 50, y: 0, surface: 'dirt', curve: 'smooth', tension: 0.5, structure: 'surface' },
    ],
    terrain: { cellSize: 32, cells: [
      { kind: 'water', row: 2, column: 3 }, { kind: 'hill', row: 1, column: 2 },
    ] },
  },
})
const racer = (id, car, player, speed, braking, surface = 'street') => ({
  id, car, player, speed, braking, currentSurface: surface,
  finishedAt: null, onCurb: false, slip: 0,
})
function replay() {
  return {
    format: 'trackforge-race-replay', formatVersion: 1, track: track().track,
    setup: { difficulty: 'hard', handling: 'arcade', car: 'red', laps: 2,
      mode: 'normal', gridPositions: [2, 1, 0, 3] },
    result: {
      playerTime: 1.5,
      standings: [
        { id: 'player', car: 'red', lap: 2, finishTime: 1.5 },
        { id: 'ai-2', car: 'blue', lap: 1, finishTime: null },
      ],
    },
    frames: [
      { t: 0, vehicles: [racer('player', 'red', true, 100, true),
        racer('ai-2', 'blue', false, 200, false, 'grass')] },
      { t: 1, vehicles: [racer('player', 'red', true, 200, false),
        racer('ai-2', 'blue', false, 100, true)] },
      { t: 2, vehicles: [racer('player', 'red', true, 300, false),
        racer('ai-2', 'blue', false, 50, false)] },
    ],
    events: [
      { t: 0.8, event: { type: 'curb-hit', vehicleId: 'ai-2', pathIndex: 53 } },
      { t: 1.25, event: { type: 'vehicle-recovered', vehicleId: 'ai-2',
        pathIndex: 75, reason: 'off-road' } },
      { t: 1.4, event: { type: 'gate-crossed', vehicleId: 'player', lap: 1, gate: 4, time: 1.4 } },
      { t: 1.75, event: { type: 'curb-hit', vehicleId: 'ai-2', pathIndex: 102 } },
    ],
  }
}
test('geometry fingerprint ignores cosmetic name, version and terrain cell ordering', () => {
  const a = track(), b = structuredClone(a)
  b.track.name = 'New name'
  b.track.version++
  b.track.terrain.cells.reverse()
  assert.equal(trackFingerprint(a), trackFingerprint(b))
  assert.equal(summarizeTrack(a).terrainCells.water, 1)
  b.track.points[0].x = 20
  assert.notEqual(trackFingerprint(a), trackFingerprint(b))
})
test('telemetry is weighted and censored at player finish without invented AI time', () => {
  const stats = summarizeRace(replay())
  assert.equal(stats.observationEnd, 1.5)
  const [red, blue] = stats.vehicles
  assert.equal(red.averageSpeed, 133.333)
  assert.equal(red.brakingSeconds, 1)
  assert.equal(blue.averageSpeed, 166.667)
  assert.equal(blue.brakingSeconds, 0.5)
  assert.equal(blue.grassSeconds, 1)
  assert.equal(blue.recoveries.length, 1)
  assert.equal(blue.events['curb-hit'], 1)
  assert.equal(blue.finishTime, null)
  assert.deepEqual(red.gates, [{ lap: 1, gate: 4, time: 1.4 }])
  assert.equal(stats.hotspots.find((h) => h.id === 'ai-2' &&
    h.counts['vehicle-recovered'])?.pathIndexFrom, 50)
})
test('full-recording includes late events', () => {
  const stats = summarizeRace(replay(), { full: true })
  assert.equal(stats.observationEnd, 2)
  assert.equal(stats.vehicles[1].events['curb-hit'], 2)
})
test('comparison matches same AI color even if it changes grid slot', () => {
  const a = replay(), b = structuredClone(a)
  b.setup.gridPositions = [1, 2, 0, 3]
  b.frames.forEach((frame) => { frame.vehicles[1].id = 'ai-3' })
  b.result.standings[1].id = 'ai-3'
  b.events.forEach((item) => {
    if (item.event.vehicleId === 'ai-2') item.event.vehicleId = 'ai-3'
  })
  const comparison = compareRaces(a, b)
  assert.equal(comparison.comparisons.length, 2)
  assert.ok(comparison.comparisons.some((v) => v.car === 'blue'))
  assert.ok(comparison.warnings.includes('Different physical starting grid'))
})
test('malformed exports cause actionable failures, never silent fallback', () => {
  assert.throws(() => summarizeRace({ ...replay(), events: null }), /missing events/)
  assert.throws(() => summarizeRace({ ...replay(), formatVersion: 2 }), /formatVersion/)
  const broken = replay()
  broken.frames[1].t = -1
  assert.throws(() => summarizeRace(broken), /nonmonotonic/)
  assert.throws(() => groupHotspots([], 0), /hotspotBin/)
})
