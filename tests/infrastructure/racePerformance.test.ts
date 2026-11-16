import { describe, expect, it } from 'vitest'
import type { RacePhase } from '@/domain/race/raceState'
import { RacePerformance } from '@/infrastructure/qa/racePerformance'

function createBenchmark() {
  let now = 0
  let countdownVisible = true
  const benchmark = new RacePerformance(() => countdownVisible, () => now)
  const setup = { car: 'blue', difficulty: 'normal', laps: 2, lighting: 'day' } as const

  return {
    benchmark,
    showCountdown(visible: boolean) { countdownVisible = visible },
    frame(time: number, phase: RacePhase, { paused = false, simulationMs = 1 } = {}) {
      now = time
      const active = benchmark.beginUpdate()
      active?.beginSimulation()
      now += simulationMs
      active?.endSimulation()
      now += 2
      active?.endUpdate()
      benchmark.beginRender()
      now += 3
      benchmark.afterRender(time, {
        track: { name: 'Starter Circuit' },
        setup,
        state: { phase, paused, vehicles: { length: 4 } },
      })
    },
  }
}

describe('race performance baseline', () => {
  it('measures countdown entry and percentiles from rendered running frames', () => {
    const { benchmark, frame, showCountdown } = createBenchmark()
    expect(benchmark.beginUpdate()).toBeUndefined()
    benchmark.markStart()
    showCountdown(false)
    frame(700, 'countdown')
    expect(benchmark.report().startToCountdownMs).toBeNull()
    showCountdown(true)
    frame(900, 'countdown')
    expect(benchmark.report()).toMatchObject({
      status: 'waiting-for-go',
      startToCountdownMs: 906,
      race: { name: 'Starter Circuit', vehicleCount: 4 },
    })
    frame(3_700, 'running', { simulationMs: 20 })
    expect(benchmark.report()).toMatchObject({ status: 'sampling', sampleCount: 0 })

    let time = 3_700
    const intervals = [...Array<number>(94).fill(48), 65, 65, 65, 65, 100, 128]
    for (const interval of intervals) {
      time += interval
      frame(time, 'running', { simulationMs: interval >= 65 ? 4 : 1 })
    }
    expect(benchmark.report()).toMatchObject({
      status: 'complete',
      startToCountdownMs: 906,
      sampleCount: 100,
      sampleDurationMs: 5_000,
      frameIntervalMs: { p50: 48, p95: 65, p99: 100 },
      raceUpdateMs: { p50: 3, p95: 6, p99: 6 },
      simulationMs: { p50: 1, p95: 4, p99: 4 },
      renderSubmissionMs: { p50: 3, p95: 3, p99: 3 },
    })
  })

  it('caps the sample window and retains the completed result', () => {
    const { benchmark, frame } = createBenchmark()
    benchmark.markStart()
    frame(200, 'countdown')
    for (let time = 3_700; time <= 5_800; time += 1) frame(time, 'running')
    expect(benchmark.report()).toMatchObject({
      status: 'complete',
      sampleCount: 2_048,
      sampleDurationMs: 2_048,
      frameIntervalMs: { p50: 1, p95: 1, p99: 1 },
    })
    expect(benchmark.beginUpdate()).toBeUndefined()
  })

  it('ends a paused capture and starts fresh with the next setup click', () => {
    const { benchmark, frame } = createBenchmark()
    benchmark.markStart()
    frame(200, 'countdown')
    frame(3_700, 'running')
    frame(3_716, 'running')
    frame(3_900, 'running', { paused: true })
    expect(benchmark.report()).toMatchObject({ status: 'interrupted', sampleCount: 1 })
    frame(4_500, 'running')
    expect(benchmark.report()).toMatchObject({ status: 'interrupted', sampleCount: 1 })
    benchmark.markStart()
    expect(benchmark.report()).toMatchObject({
      status: 'waiting-for-countdown',
      race: null,
      startToCountdownMs: null,
      sampleCount: 0,
      sampleDurationMs: 0,
      frameIntervalMs: null,
    })
  })
})
