import { expect, it, vi } from 'vitest'
import { RacePresentationPreparation } from '@/phaser/rendering/racePresentationPreparation'
import { buildTrackGeometry } from '@/domain/track/trackGeometry'
import { EMPTY_TERRAIN } from '@/domain/terrain/terrainField'

const geometry = buildTrackGeometry({
  points: [
    { x: 0, y: 0, surface: 'street' },
    { x: 600, y: 0, surface: 'street' },
    { x: 600, y: 400, surface: 'street' },
    { x: 0, y: 400, surface: 'street' },
    { x: 0, y: 0, surface: 'street' },
  ],
  terrain: EMPTY_TERRAIN,
})

it('reports deferred prewarm failure while allowing a later normal preparation', () => {
  const pending: (() => void)[] = []
  const schedule = (task: () => void) => {
    pending.push(task)
    return vi.fn()
  }
  const failure = new Error('Tile cache unavailable')
  const report = vi.fn()
  const preparation = new RacePresentationPreparation(schedule, () => 0, report)
  preparation.prepare(geometry, 'grass', false, {
    width: 400, height: 240,
    textures: {
      exists: () => { throw failure },
      addCanvas: vi.fn(),
    } as never,
  })

  expect(report).not.toHaveBeenCalled()
  pending.shift()?.()
  expect(report).toHaveBeenCalledTimes(1)
  expect(report).toHaveBeenCalledWith(failure)

  // An optional prewarm failure must not poison subsequent race loading.
  preparation.prepare(geometry, 'grass', false)
  expect(() => pending.shift()?.()).not.toThrow()
  expect(report).toHaveBeenCalledTimes(1)
})

it('does not report or process stale preparation work after cancellation', () => {
  let run: (() => void) | undefined
  const cancel = vi.fn()
  const report = vi.fn()
  const preparation = new RacePresentationPreparation(task => { run = task; return cancel }, () => 0, report)
  preparation.prepare(geometry, 'grass', false, {
    width: 400, height: 240,
    textures: { exists: () => { throw new Error('stale') }, addCanvas: vi.fn() } as never,
  })
  preparation.cancel()
  expect(cancel).toHaveBeenCalledTimes(1)
  run?.()
  expect(report).not.toHaveBeenCalled()
})
