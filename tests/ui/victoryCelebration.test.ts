// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VictoryCelebration } from '@/ui/components/victoryCelebration'
import { createFinishCelebration } from '@/ui/components/finishMedal'

const mount = (): HTMLElement => {
  const overlay = document.createElement('div')
  document.body.append(overlay)
  return overlay
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('victory fireworks lifecycle', () => {
  it('plays gold once per run, forwards quality and cleans up on navigation', () => {
    const lifecycle = new VictoryCelebration()
    const overlay = mount()
    overlay.append(createFinishCelebration('GOLD'))
    const stop = vi.fn()
    const play = vi.fn(() => stop)
    const detach = lifecycle.attach(overlay, 1, 'low', play)
    const layer = overlay.querySelector('.results-victory-fireworks')
    expect(layer?.getAttribute('aria-hidden')).toBe('true')
    expect(play).toHaveBeenCalledWith(layer, 'low')
    detach()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(overlay.querySelector('.results-victory-fireworks')).toBeNull()
    lifecycle.attach(overlay, 1, 'high', play)()
    expect(play).toHaveBeenCalledTimes(1)
    lifecycle.attach(overlay, 2, 'high', play)()
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('waits for a late gold medal, ignores silver, and stops when splits replace the medal', async () => {
    const lifecycle = new VictoryCelebration()
    const overlay = mount()
    overlay.append(createFinishCelebration('SILVER'))
    const stop = vi.fn()
    const play = vi.fn(() => stop)
    const detach = lifecycle.attach(overlay, 3, 'medium', play)
    expect(play).not.toHaveBeenCalled()
    overlay.replaceChildren(createFinishCelebration('GOLD'))
    await Promise.resolve()
    expect(play).toHaveBeenCalledTimes(1)
    overlay.replaceChildren()
    await Promise.resolve()
    expect(stop).toHaveBeenCalledTimes(1)
    overlay.append(createFinishCelebration('GOLD'))
    await Promise.resolve()
    expect(play).toHaveBeenCalledTimes(1)
    detach()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('respects reduced motion even on gold', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const overlay = mount()
    overlay.append(createFinishCelebration('GOLD'))
    const play = vi.fn(() => vi.fn())
    new VictoryCelebration().attach(overlay, 4, 'high', play)()
    expect(play).not.toHaveBeenCalled()
    expect(overlay.querySelector('.results-victory-fireworks')).toBeNull()
  })
})
