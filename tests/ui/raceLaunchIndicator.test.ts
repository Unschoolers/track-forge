// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RaceLaunchIndicator } from '@/ui/components/raceLaunchIndicator'

afterEach(() => vi.restoreAllMocks())

function setup() {
  const root = document.createElement('div')
  const screen = document.createElement('div')
  root.append(screen)
  const indicator = new RaceLaunchIndicator(root)
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.push(callback)
    return frames.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  return { root, screen, indicator, nextFrame: () => frames.shift()?.(0) }
}

describe('race launch feedback', () => {
  it('paints before dispatch and survives a screen replacement until the matching run renders', () => {
    const { root, screen, indicator, nextFrame } = setup()
    const launch = vi.fn(() => 2)
    indicator.begin(launch)
    indicator.begin(launch)
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Loading race')
    expect(screen.inert).toBe(true)
    nextFrame()
    expect(launch).not.toHaveBeenCalled()
    nextFrame()
    expect(launch).toHaveBeenCalledTimes(1)
    const newScreen = document.createElement('div')
    root.replaceChildren(newScreen)
    indicator.cover()
    expect(newScreen.inert).toBe(true)
    indicator.presented(1)
    expect(root.querySelector('[role="status"]')).not.toBeNull()
    indicator.presented(2)
    expect(root.querySelector('[role="status"]')).toBeNull()
    expect(newScreen.inert).toBe(false)
    expect(indicator.timing(2)?.totalMs).toBeGreaterThanOrEqual(0)
    expect(indicator.timing(1)).toBeUndefined()
  })

  it('cleans up rejected launches and cancels pending work', () => {
    const { root, screen, indicator, nextFrame } = setup()
    const rejected = vi.fn(() => undefined)
    indicator.begin(rejected)
    nextFrame()
    nextFrame()
    expect(root.querySelector('[role="status"]')).toBeNull()
    expect(screen.inert).toBe(false)
    const launch = vi.fn(() => 3)
    indicator.begin(launch)
    nextFrame()
    indicator.cancel()
    nextFrame()
    expect(launch).not.toHaveBeenCalled()
    expect(screen.inert).toBe(false)
  })
})
