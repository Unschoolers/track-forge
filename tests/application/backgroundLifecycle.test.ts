import { describe, expect, it, vi } from 'vitest'
import { handleBackground } from '@/application/backgroundLifecycle'

describe('background lifecycle', () => {
  it.each([
    ['race', 'none', true],
    ['race', 'results', false],
    ['editor', 'none', false],
  ] as const)('pauses only an unfinished race without saving editor drafts (%s, %s)', (mode, overlay, shouldPause) => {
    const controller = {
      snapshot: () => ({ mode, overlay: { type: overlay } }),
      dispatch: vi.fn(),
    }
    handleBackground(controller)
    expect(controller.dispatch).toHaveBeenCalledTimes(shouldPause ? 1 : 0)
    if (shouldPause) expect(controller.dispatch).toHaveBeenCalledWith({ type: 'pause-race' })
  })
})
