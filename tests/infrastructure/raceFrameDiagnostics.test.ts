import { describe, expect, it } from 'vitest'
import { RaceFrameDiagnostics } from '@/infrastructure/qa/raceFrameDiagnostics'

describe('race frame diagnostics', () => {
  it('records timings with simulation ticks, excludes paused gaps and resets for a new race', () => {
    let now = 0
    const recorder = new RaceFrameDiagnostics(() => now)
    const frame = (time: number, tick: number, running = true) => {
      recorder.beginUpdate(1)
      now += 1
      recorder.beginSimulation()
      now += 2
      recorder.endSimulation()
      now += 1
      recorder.endUpdate()
      recorder.beginRender()
      now += 3
      recorder.afterRender(time, tick, running)
    }
    frame(100, 1)
    frame(116, 2)
    recorder.recordBitmapWork({ operation: 'upload', layer: 1, tile: '2:3', priority: 0, durationMs: 12 })
    frame(130, 2, false)
    recorder.recordBitmapWork({ operation: 'prepare', layer: 1, tile: '2:4', priority: 0, durationMs: 5 })
    frame(5000, 3)
    frame(5034, 5)
    expect(recorder.report(1)).toMatchObject({
      frameCount: 2,
      frames: [[2, 16, 4, 2, 3], [5, 34, 4, 2, 3]],
      bitmapWork: [{ operation: 'upload', layer: 1, tile: '2:3', priority: 0, durationMs: 12, afterFrame: 1 }],
    })
    expect(recorder.report(2)).toBeNull()
    recorder.beginUpdate(2)
    expect(recorder.report(2)).toMatchObject({ frameCount: 0, frames: [], bitmapWork: [] })
  })
})
