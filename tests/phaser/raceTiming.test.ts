import { createRequire } from 'node:module'
import { expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({ default: { Scene: class {} } }))
import { RaceScene } from '@/phaser/scenes/RaceScene'

it('uses the actual raw Phaser TimeStep delta after reset instead of its smoothed callback delta', () => {
  const require = createRequire(import.meta.url)
  const TimeStep = require(`${process.cwd()}/node_modules/phaser/src/core/TimeStep.js`)
  const loop = new TimeStep({}, {})
  const advance = vi.fn()
  const scene = { vehicleGraphics: {}, shadowGraphics: {}, upperVehicleGraphics: {}, effectGraphics: {}, snapshot: {}, controller: { snapshot: () => ({}) }, raceSession: { advance, snapshot: () => ({ state: null }) }, controls: { snapshot: () => ({}) }, game: { loop } }
  loop.deltaHistory = Array(10).fill(loop._target)
  loop.resetDelta()
  let time = loop.lastTime
  loop.callback = (now: number, delta: number) => RaceScene.prototype.update.call(scene as never, now, delta)
  for (let i = 0; i < 120; i++) { time += 100; loop.step(time) }
  expect(advance).toHaveBeenCalledTimes(120)
  expect(advance.mock.calls.reduce((sum, [delta]) => sum + delta, 0)).toBeCloseTo(12, 8)
})
