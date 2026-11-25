import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const script = join(root, 'qa/perf/track-profile.mjs')

test('profiles import, geometry, terrain presentation, and editor commands', () => {
  const directory = mkdtempSync(join(tmpdir(), 'track-profile-'))
  try {
    const input = join(directory, 'fixture.json')
    writeFileSync(input, JSON.stringify({ track: {
      id: 'profile-fixture', name: 'Fixture', version: 8, routeKind: 'circuit',
      points: [
        { x: 0, y: 0, surface: 'street', curve: 'smooth', tension: 0.5, structure: 'surface' },
        { x: 100, y: 0, surface: 'street', curve: 'smooth', tension: 0.5, structure: 'surface' },
        { x: 100, y: 100, surface: 'street', curve: 'smooth', tension: 0.5, structure: 'surface' },
      ],
      trees: [], terrain: { cellSize: 64, cells: [{ column: 2, row: 2, kind: 'hill' }] },
      start: { ratio: 0, reversed: false }, scenery: [], environmentId: 'grass',
    } }))
    const result = spawnSync(process.execPath, [script, input], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.track.name, 'Fixture')
    assert.equal(report.track.terrainCellCount, 1)
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
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
