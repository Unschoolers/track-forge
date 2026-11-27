import { describe, expect, it, vi } from 'vitest'
import { handleAndroidBack } from '@/application/androidBackNavigation'
import type { AppSnapshot } from '@/application/appState'

const state = (
  mode: AppSnapshot['mode'],
  overlay: AppSnapshot['overlay'],
  hasName = true,
): Pick<AppSnapshot, 'mode' | 'overlay' | 'preferences'> => ({
  mode,
  overlay,
  preferences: {
    car: 'blue',
    difficulty: 'normal',
    audioEnabled: true,
    hapticsEnabled: true,
    dynamicZoomEnabled: true,
    ...(hasName ? { displayName: 'Player' } : {}),
  },
})

describe('Android Back navigation', () => {
  it.each([
    ['home', { type: 'options', returnTo: 'home' }, { type: 'close-overlay' }],
    ['editor', { type: 'editor-menu' }, { type: 'close-overlay' }],
    ['editor', { type: 'none' }, { type: 'go-home' }],
    ['race', { type: 'none' }, { type: 'pause-race' }],
    ['race', { type: 'pause' }, { type: 'resume-race' }],
    ['race', { type: 'results' }, { type: 'close-overlay' }],
    ['home', { type: 'track-library', purpose: 'edit' }, { type: 'close-overlay' }],
  ] as const)('handles Back in %s with %s', (mode, overlay, expected) => {
    const dispatch = vi.fn()
    expect(handleAndroidBack(state(mode, overlay), dispatch)).toBe(true)
    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith(expected)
  })

  it('opens the shared exit confirmation on Home and dismisses it on a second Back', () => {
    const dispatch = vi.fn()
    expect(handleAndroidBack(state('home', { type: 'none' }), dispatch)).toBe(true)
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-app-exit' })
    dispatch.mockClear()
    expect(handleAndroidBack(state('home', { type: 'app-exit' }), dispatch)).toBe(true)
    expect(dispatch).toHaveBeenCalledWith({ type: 'close-overlay' })
  })

  it('does not dismiss a required first-launch name screen', () => {
    const dispatch = vi.fn()
    expect(handleAndroidBack(state('home', { type: 'player-name' }, false), dispatch)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('closes name dialogs instead of accidentally exiting while editing', () => {
    const dispatch = vi.fn()
    expect(handleAndroidBack(state('editor', {
      type: 'track-name', purpose: 'rename', returnTo: { type: 'editor-menu' },
    }), dispatch)).toBe(true)
    expect(dispatch).toHaveBeenCalledWith({ type: 'close-overlay' })
  })
})
