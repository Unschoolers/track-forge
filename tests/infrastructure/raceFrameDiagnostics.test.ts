import { describe, expect, it } from 'vitest'
import { RaceFrameDiagnostics } from '@/infrastructure/qa/raceFrameDiagnostics'

describe('race frame diagnostics', () => {
  it('aligns camera and layer workload with the frame sample and bounds long tasks to the run', () => {
    let now = 100
    const recorder = new RaceFrameDiagnostics(() => now)
    recorder.setRenderer('webgl', 844, 390, { cssWidth: 844, cssHeight: 390, devicePixelRatio: 2 })
    const frame = (time: number) => {
      recorder.beginUpdate(7)
      recorder.beginSimulation()
      now += 1
      recorder.endSimulation()
      recorder.beginGround()
      now += 2
      recorder.endGround()
      now += 3
      recorder.endVehicles()
      now += 4
      recorder.endUpdate()
      recorder.recordPresentation(Array.from({ length: 23 }, (_, i) => i))
      recorder.beginRender()
      now += 5
      recorder.afterRender(time, 3, true)
    }
    frame(100)
    recorder.recordLongTask(90, 55)
    recorder.recordLongTask(110, 65)
    frame(116)
    const report = recorder.report(7)
    expect(report?.presentationFrames).toEqual([[116, 115, 2, 3, 4, ...Array.from({ length: 23 }, (_, i) => i)]])
    expect(report?.presentationColumns).toHaveLength(28)
    expect(report?.longTasks).toEqual([[110, 65]])
    expect(report?.renderer).toEqual({ type: 'webgl', width: 844, height: 390, cssWidth: 844, cssHeight: 390, devicePixelRatio: 2 })
    recorder.endRace()
    recorder.recordLongTask(150, 80)
    expect(recorder.report(7)?.longTasks).toEqual([[110, 65]])
    recorder.beginUpdate(8)
    expect(recorder.report(8)).toMatchObject({ presentationFrames: [], longTasks: [] })
  })

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
    const exported = recorder.report(1)
    recorder.beginUpdate(2)
    expect(exported).toMatchObject({ frameCount: 2, frames: [[2, 16, 4, 2, 3], [5, 34, 4, 2, 3]],
      bitmapWork: [{ operation: 'upload' }] })
    expect(recorder.report(2)).toMatchObject({ frameCount: 0, frames: [], bitmapWork: [] })
  })
})
