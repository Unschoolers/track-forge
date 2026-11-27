import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const script = join(root, 'qa/perf/track-profile.mjs')

function runProfile(track) {
  const directory = mkdtempSync(join(tmpdir(), 'track-profile-'))
  try {
    const input = join(directory, 'fixture.json')
    writeFileSync(input, JSON.stringify({ track }))
    return spawnSync(process.execPath, [script, input], { cwd: root, encoding: 'utf8' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function fixture(routeKind, points) {
  return {
      id: 'profile-fixture', name: 'Fixture', version: 8,
      routeKind,
      points,
      trees: [], terrain: { cellSize: 64, cells: [{ column: 2, row: 2, kind: 'hill' }] },
      start: { ratio: 0, reversed: false }, scenery: [], environmentId: 'grass',
  }
}

const point = (x, y) => ({ x, y, surface: 'street', curve: 'smooth', tension: 0.5, structure: 'surface' })

test('profiles import, geometry, terrain presentation, and editor commands', () => {
  const result = runProfile(fixture('circuit', [point(0, 0), point(100, 0), point(100, 100)]))
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.track.name, 'Fixture')
  assert.equal(report.track.terrainCellCount, 1)
  assert.equal(report.timingsMs.pointCoordinateChanged, true)
  for (const stage of [
    'jsonParse', 'decodeTrack', 'geometryCold', 'geometryWarmCacheLookup',
    'terrainPresentationFull', 'terrainPresentationOverview',
    'editorTerrainPaint16Cells', 'geometryAfterTerrainPaint',
    'editorMoveOnePoint', 'geometryAfterPointMove',
  ]) {
    assert.equal(typeof report.timingsMs[stage], 'number', stage)
    assert.ok(report.timingsMs[stage] >= 0, stage)
  }
  assert.ok(report.terrainPresentation.full.triangleCount >= 0)
})

test('finds a valid point edit for an over-limit legacy route', () => {
  const result = runProfile(fixture('point-to-point', [point(0, 0), point(60_000, 30_000), point(120_000, 0)]))
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.timingsMs.pointCoordinateChanged, true)
})
