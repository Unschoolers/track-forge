import { describe, expect, it, vi } from 'vitest'
import { WebAudioAdapter, type ToneSink } from '@/infrastructure/feedback/webAudioAdapter'
import { HapticsAdapter } from '@/infrastructure/feedback/hapticsAdapter'

describe('feedback adapters', () => {
  it('stays locked until a gesture then maps continuous and one-shot audio', () => {
    const sink: ToneSink = {
      unlock: vi.fn(),
      play: vi.fn(),
      setEngine: vi.fn(),
      setSurface: vi.fn(),
      setSlip: vi.fn(),
      silenceContinuous: vi.fn(),
      destroy: vi.fn(),
    }
    const createSink = vi.fn(() => sink)
    const audio = new WebAudioAdapter(createSink, true)
    audio.handle({ type: 'collision', strength: 0.8 })
    expect(createSink).not.toHaveBeenCalled()
    expect(sink.play).not.toHaveBeenCalled()

    audio.unlock()
    audio.unlock()
    expect(createSink).toHaveBeenCalledOnce()
    expect(sink.unlock).toHaveBeenCalledOnce()
    audio.handle({
      type: 'engine',
      car: 'green',
      speedRatio: 0.7,
      throttle: 1,
      cornering: 0.6,
    })
    audio.handle({ type: 'surface', surface: 'dirt', speedRatio: 0.6 })
    audio.handle({ type: 'tire-slip', strength: 0.4 })
    audio.handle({ type: 'collision', strength: 0.8 })
    expect(sink.setEngine).toHaveBeenCalledWith('green', 0.7, 1, 0.6)
    expect(sink.setSurface).toHaveBeenCalledWith('dirt', 0.6)
    expect(sink.setSlip).toHaveBeenCalledWith(0.4)
    expect(sink.play).toHaveBeenCalledWith(
      90,
      0.12,
      expect.any(Number),
      'sawtooth',
    )
    audio.setEnabled(false)
    expect(sink.silenceContinuous).toHaveBeenCalledOnce()
    audio.handle({ type: 'finish', place: 1, newRecord: true })
    expect(sink.play).toHaveBeenCalledOnce()
    audio.silenceContinuous()
    expect(sink.silenceContinuous).toHaveBeenCalledTimes(2)
    audio.destroy()
    expect(sink.destroy).toHaveBeenCalledOnce()
  })

  it('degrades safely when vibration is unavailable or disabled', () => {
    const vibrate = vi.fn(() => true)
    const haptics = new HapticsAdapter(vibrate, true)
    haptics.handle({ type: 'curb', speed: 100 })
    expect(vibrate).toHaveBeenCalledWith([12])
    haptics.setEnabled(false)
    haptics.handle({ type: 'finish', place: 1, newRecord: false })
    expect(vibrate).toHaveBeenCalledOnce()

    expect(() =>
      new HapticsAdapter(undefined, true).handle({
        type: 'collision',
        strength: 1,
      }),
    ).not.toThrow()
    haptics.destroy()
  })
})
