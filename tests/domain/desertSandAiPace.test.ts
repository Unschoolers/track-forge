// @vitest-environment node
// Real reverse Desert sand 2-lap replay geometry. The track is a regression
// fixture, never a runtime AI selector; no human control inputs are scripted.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runLaneCheck } from '../../qa/lanes/simulation'
import { decodeTrackInput, prepareLanePath } from '../../qa/lanes/scenarios'

const [candidate] = decodeTrackInput(JSON.parse(readFileSync(
  'tests/fixtures/desertSandAi.trackforge.json', 'utf8',
)))
if (!candidate) throw new Error('Missing Desert sand AI regression fixture')
const track = candidate
const path = prepareLanePath(track)
const startRatio = track.start?.ratio ?? 0
// Real four-car grid from the export; Hard mirrors the player Green.
const gridPositions = [1, 3, 0, 2] as const
const seeds = [1, 4331] as const

function race(seed: number, difficulty: 'hard' | 'normal', mode: 'solo' | 'traffic') {
  return runLaneCheck({
    path, trackName: track.name, seed, difficulty,
    car: 'green', reversed: true, handling: 'arcade',
    mode, startRatio, gridPositions, laps: 2, seconds: 75,
  })
}

describe('Green AI on the real reverse Desert sand circuit', () => {
  it.each(seeds)('Hard drives a clean, faster two-lap solo race (seed %i)', seed => {
    const hard = race(seed, 'hard', 'solo')
    const normal = race(seed, 'normal', 'solo')
    const green = hard.vehicles[0]
    const normalGreen = normal.vehicles[0]
    if (!green || !normalGreen) throw new Error('Missing Green AI')
    expect(green.recoveries, JSON.stringify(hard.issues)).toBe(0)
    expect(green.finishedAt, JSON.stringify(hard.issues)).not.toBeNull()
    expect(normalGreen.finishedAt).not.toBeNull()
    expect(green.finishedAt ?? Infinity).toBeLessThan(30.5)
    expect(green.finishedAt ?? Infinity).toBeLessThan(normalGreen.finishedAt ?? Infinity)
  }, 30000)

  it.each(seeds)('Hard Green completes the recorded full grid without forced recovery (seed %i)', seed => {
    const run = race(seed, 'hard', 'traffic')
    const greens = run.vehicles.filter(v => v.car === 'green')
    expect(greens).toHaveLength(2)
    for (const green of greens) {
      expect(green.recoveries, JSON.stringify(run.issues)).toBe(0)
      expect(green.finishedAt, JSON.stringify(run.issues)).not.toBeNull()
      expect(green.finishedAt ?? Infinity).toBeLessThan(31)
    }
  }, 30000)
})
