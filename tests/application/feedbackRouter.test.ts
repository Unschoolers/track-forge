import { describe, expect, it, vi } from 'vitest'
import type { FeedbackPort } from '@/application/ports/feedback'
import { FeedbackRouter } from '@/application/feedback/feedbackRouter'

function port(): FeedbackPort {
  return {
    unlock: vi.fn(),
    setEnabled: vi.fn(),
    handle: vi.fn(),
    silenceContinuous: vi.fn(),
    destroy: vi.fn(),
  }
}

describe('FeedbackRouter', () => {
  it('fans out events, unlocks once, and applies channel preferences', () => {
    const audio = port()
    const haptics = port()
    const router = new FeedbackRouter({ audio, haptics, now: () => 100 })

    router.unlock()
    router.unlock()
    router.setChannels({ audio: false, haptics: true })
    router.handle({ type: 'collision', strength: 80 })
    router.silenceContinuous()

    expect(audio.unlock).toHaveBeenCalledOnce()
    expect(haptics.unlock).toHaveBeenCalledOnce()
    expect(audio.setEnabled).toHaveBeenCalledWith(false)
    expect(haptics.setEnabled).toHaveBeenCalledWith(true)
    expect(audio.handle).toHaveBeenCalledWith({
      type: 'collision',
      strength: 80,
    })
    expect(haptics.handle).toHaveBeenCalledWith({
      type: 'collision',
      strength: 80,
    })
    expect(audio.silenceContinuous).toHaveBeenCalledOnce()
    expect(haptics.silenceContinuous).toHaveBeenCalledOnce()
  })

  it('rate-limits curb and tire-slip streams without dropping engine updates', () => {
    const audio = port()
    const haptics = port()
    let now = 100
    const router = new FeedbackRouter({
      audio,
      haptics,
      now: () => now,
    })

    router.handle({ type: 'curb', speed: 100 })
    router.handle({ type: 'curb', speed: 110 })
    router.handle({ type: 'tire-slip', strength: 0.7 })
    router.handle({ type: 'tire-slip', strength: 0.8 })
    router.handle({
      type: 'engine',
      car: 'blue',
      speedRatio: 0.5,
      throttle: 1,
      cornering: 0,
    })
    router.handle({
      type: 'engine',
      car: 'blue',
      speedRatio: 0.6,
      throttle: 1,
      cornering: 0,
    })
    expect(audio.handle).toHaveBeenCalledTimes(4)

    now += 150
    router.handle({ type: 'curb', speed: 120 })
    router.handle({ type: 'tire-slip', strength: 0.9 })
    expect(audio.handle).toHaveBeenCalledTimes(6)

    router.destroy()
    router.destroy()
    expect(audio.destroy).toHaveBeenCalledOnce()
    expect(haptics.destroy).toHaveBeenCalledOnce()
  })
})
