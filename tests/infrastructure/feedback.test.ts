import { describe, expect, it, vi } from 'vitest'
import { BrowserToneSink, WebAudioAdapter, type ToneSink } from '@/infrastructure/feedback/webAudioAdapter'
import { HapticsAdapter } from '@/infrastructure/feedback/hapticsAdapter'

describe('feedback adapters', () => {

  it('plays gentle countdown tones through the enabled audio channel', () => {
    const sink: ToneSink = {
      unlock: vi.fn(), play: vi.fn(), playLanding: vi.fn(), setEngine: vi.fn(), setSurface: vi.fn(),
      setSlip: vi.fn(), silenceContinuous: vi.fn(), destroy: vi.fn(),
    }
    const audio = new WebAudioAdapter(() => sink, true)
    audio.unlock()
    audio.handle({ type: 'countdown', cue: 3 })
    audio.handle({ type: 'countdown', cue: 'go' })
    expect(sink.play).toHaveBeenNthCalledWith(1, 660, 0.14, 0.105, 'sine')
    expect(sink.play).toHaveBeenNthCalledWith(2, 880, 0.22, 0.105, 'sine')
    audio.setEnabled(false)
    audio.handle({ type: 'countdown', cue: 2 })
    expect(sink.play).toHaveBeenCalledTimes(2)
  })

  it('plays a short boost ignition cue only when audio is enabled', () => {
    const sink: ToneSink = {
      unlock: vi.fn(), play: vi.fn(), playLanding: vi.fn(), setEngine: vi.fn(), setSurface: vi.fn(),
      setSlip: vi.fn(), silenceContinuous: vi.fn(), destroy: vi.fn(),
    }
    const audio = new WebAudioAdapter(() => sink, true)
    audio.unlock()
    audio.handle({ type: 'boost-ignition' })
    expect(sink.play).toHaveBeenCalledTimes(2)
    audio.setEnabled(false)
    audio.handle({ type: 'boost-ignition' })
    expect(sink.play).toHaveBeenCalledTimes(2)
  })

  it('uses one brief ignition vibration only when haptics are enabled', () => {
    const vibrate = vi.fn(() => true)
    const haptics = new HapticsAdapter(vibrate, true)
    haptics.handle({ type: 'boost-ignition' })
    expect(vibrate).toHaveBeenCalledWith([18])
    haptics.setEnabled(false)
    haptics.handle({ type: 'boost-ignition' })
    expect(vibrate).toHaveBeenCalledOnce()
  })

  it('routes the jump release to its own sound only while enabled', () => {
    const sink: ToneSink = {
      unlock: vi.fn(), play: vi.fn(), playLanding: vi.fn(), playJumpTakeoff: vi.fn(),
      setEngine: vi.fn(), setSurface: vi.fn(), setSlip: vi.fn(), silenceContinuous: vi.fn(), destroy: vi.fn(),
    }
    const audio = new WebAudioAdapter(() => sink, true)
    audio.handle({ type: 'jump-takeoff', strength: 0.8 })
    expect(sink.playJumpTakeoff).not.toHaveBeenCalled()
    audio.unlock()
    audio.handle({ type: 'jump-takeoff', strength: 0.8 })
    expect(sink.playJumpTakeoff).toHaveBeenCalledExactlyOnceWith(0.8)
    audio.setEnabled(false)
    audio.handle({ type: 'jump-takeoff', strength: 0.8 })
    expect(sink.playJumpTakeoff).toHaveBeenCalledTimes(1)
  })

  it('stays locked until a gesture then maps continuous and one-shot audio', () => {
    const sink: ToneSink = {
      unlock: vi.fn(),
      play: vi.fn(),
      playLanding: vi.fn(),
      setEngine: vi.fn(),
      setSurface: vi.fn(),
      setSlip: vi.fn(),
      silenceContinuous: vi.fn(),
      destroy: vi.fn(),
    }
    const createSink = vi.fn(() => sink)
    const audio = new WebAudioAdapter(createSink, true)
    audio.handle({ type: 'countdown', cue: 'go' })
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
    audio.handle({ type: 'countdown', cue: 'go' })
    expect(sink.setEngine).toHaveBeenCalledWith('green', 0.7, 1, 0.6)
    expect(sink.setSurface).toHaveBeenCalledWith('dirt', 0.6)
    expect(sink.setSlip).toHaveBeenCalledWith(0.4, undefined, undefined)
    audio.handle({ type: 'landing', strength: 0.8 })
    expect(sink.playLanding).toHaveBeenCalledWith(0.8)
    expect(sink.play).toHaveBeenCalledWith(
      880,
      0.22,
      expect.any(Number),
      'sine',
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

  it('rewards a lead and first-place finish with ascending audio and distinct haptics', () => {
    const sink: ToneSink = {
      unlock: vi.fn(), play: vi.fn(), playLanding: vi.fn(),
      setEngine: vi.fn(), setSurface: vi.fn(), setSlip: vi.fn(),
      silenceContinuous: vi.fn(), destroy: vi.fn(),
    }
    const audio = new WebAudioAdapter(() => sink, true)
    const vibrate = vi.fn(() => true)
    const haptics = new HapticsAdapter(vibrate, true)
    audio.unlock()
    audio.handle({ type: 'position-change', direction: 'gain', place: 1 })
    haptics.handle({ type: 'position-change', direction: 'gain', place: 1 })
    expect(sink.play).toHaveBeenCalledWith(1109, 0.24, 0.058, 'triangle', 0.11)
    expect(vibrate).toHaveBeenCalledWith([18, 25, 40, 30, 48])
    vi.mocked(sink.play).mockClear()
    audio.handle({ type: 'finish', place: 1, newRecord: true })
    haptics.handle({ type: 'finish', place: 1, newRecord: true })
    expect(sink.play).toHaveBeenCalledTimes(3)
    expect(sink.play).toHaveBeenLastCalledWith(1319, 0.43, 0.085, 'triangle', 0.32)
    expect(vibrate).toHaveBeenLastCalledWith([35, 45, 45, 45, 95])

    vi.mocked(sink.play).mockClear()
    audio.handle({ type: 'position-change', direction: 'loss', place: 2 })
    haptics.handle({ type: 'position-change', direction: 'loss', place: 2 })
    expect(sink.play).toHaveBeenCalledWith(330, 0.22, 0.03, 'triangle', 0.09)
    expect(vibrate).toHaveBeenLastCalledWith([42])
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
        type: 'curb',
        speed: 100,
      }),
    ).not.toThrow()
    haptics.destroy()
  })
})

it('vibrates only on surface transitions and resets after silence', () => {
  const vibrate = vi.fn(() => true)
  const haptics = new HapticsAdapter(vibrate, true)
  haptics.handle({ type: 'surface', surface: 'grass', speedRatio: 0.5 })
  haptics.handle({ type: 'surface', surface: 'grass', speedRatio: 0.5 })
  expect(vibrate).toHaveBeenCalledOnce()
  haptics.silenceContinuous()
  haptics.handle({ type: 'surface', surface: 'grass', speedRatio: 0.5 })
  expect(vibrate).toHaveBeenCalledTimes(2)
})

it('brings the slip voice to exact silence after grip returns', () => {
  const gain = { setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }
  const frequency = { setTargetAtTime: vi.fn() }
  const sink = new BrowserToneSink()
  Object.assign(sink, { context: { currentTime: 2 }, slipGain: { gain }, slipFilter: { frequency } })
  sink.setSlip(0, 1, 'street')
  expect(gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number))
})
