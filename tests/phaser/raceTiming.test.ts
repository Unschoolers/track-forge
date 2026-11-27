// @vitest-environment jsdom

import { createRequire } from 'node:module'
import { expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({ default: { Scene: class {}, Core: { Events: { POST_RENDER: 'postrender' } } } }))
import { RaceScene } from '@/phaser/scenes/RaceScene'

it('uses the actual raw Phaser TimeStep delta after reset instead of its smoothed callback delta', () => {
  const require = createRequire(import.meta.url)
  const TimeStep = require(`${process.cwd()}/node_modules/phaser/src/core/TimeStep.js`)
  const loop = new TimeStep({}, {})
  const advance = vi.fn()
  const scene = { vehicleGraphics: {}, shadowGraphics: {}, upperVehicleGraphics: {}, effectGraphics: {}, snapshot: {}, controller: { snapshot: () => ({ preferences: { pedalMode: 'auto' } }) }, raceSession: { advance, snapshot: () => ({ state: null }) }, controls: { consumeBoostRequest: () => false, snapshot: () => ({}) }, game: { loop } }
  loop.deltaHistory = Array(10).fill(loop._target)
  loop.resetDelta()
  let time = loop.lastTime
  loop.callback = (now: number, delta: number) => RaceScene.prototype.update.call(scene as never, now, delta)
  for (let i = 0; i < 120; i++) { time += 100; loop.step(time) }
  expect(advance).toHaveBeenCalledTimes(120)
  expect(advance.mock.calls.reduce((sum, [delta]) => sum + delta, 0)).toBeCloseTo(12, 8)
})

it('waits for the first submitted race frame and preserves visible local countdown cues across stalls', () => {
  const advance = vi.fn()
  const snapshot = vi.fn().mockReturnValue({ state: null })
  const once = vi.fn<(event: string, callback: () => void) => void>()
  const controller = { snapshot: () => ({ preferences: { pedalMode: 'auto' } }) }
  const controls = { consumeBoostRequest: () => false, snapshot: () => ({}) }
  const loop = { rawDelta: 4000 }
  const scene = Object.assign(
    new RaceScene(controller as never, { advance, snapshot } as never, controls as never, {} as never),
    { vehicleGraphics: {}, shadowGraphics: {}, upperVehicleGraphics: {}, effectGraphics: {}, snapshot: {}, game: { loop, events: { once } } },
  )
  const update = (mode: string, phase: string, rawDelta: number) => {
    loop.rawDelta = rawDelta
    // The scene exits after advancing, so this test needs no renderer.
    snapshot.mockReturnValueOnce({ state: null })
      .mockReturnValueOnce({ state: { phase }, setup: { mode } })
    scene.update(0, 16)
  }

  update('normal', 'countdown', 4000)
  update('normal', 'countdown', 2000)
  expect(advance.mock.calls.map(([delta]) => delta)).toEqual([0, 0])
  expect(once).toHaveBeenCalledExactlyOnceWith('postrender', expect.any(Function))
  const onRender = once.mock.calls[0]?.[1]
  if (!onRender) throw new Error('Missing first render callback')
  onRender()
  update('normal', 'countdown', 4000)
  update('normal', 'countdown', 16)
  update('normal', 'running', 4000)
  update('nearby', 'countdown', 4000)
  expect(advance.mock.calls.map(([delta]) => delta)).toEqual([0, 0, 0.1, 0.016, 4, 4])
})
