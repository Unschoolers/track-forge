import { describe, expect, it, vi } from 'vitest'
import {
  createApplication,
  type SceneHost,
  type UiHost,
} from '@/app/createApplication'

describe('createApplication', () => {
  it('mounts the UI before starting the home scene', () => {
    const calls: string[] = []
    const sceneHost: SceneHost = {
      start: vi.fn((mode) => calls.push(`scene:${mode}`)),
      destroy: vi.fn(),
    }
    const uiHost: UiHost = {
      mount: vi.fn(() => calls.push('ui:mount')),
      destroy: vi.fn(),
    }

    const app = createApplication({ sceneHost, uiHost })
    app.start()

    expect(calls).toEqual(['ui:mount', 'scene:home'])
  })

  it('starts and destroys its adapters at most once', () => {
    const sceneHost: SceneHost = {
      start: vi.fn(),
      destroy: vi.fn(),
    }
    const uiHost: UiHost = {
      mount: vi.fn(),
      destroy: vi.fn(),
    }
    const app = createApplication({ sceneHost, uiHost })

    app.start()
    app.start()
    app.destroy()
    app.destroy()

    expect(uiHost.mount).toHaveBeenCalledOnce()
    expect(sceneHost.start).toHaveBeenCalledOnce()
    expect(uiHost.destroy).toHaveBeenCalledOnce()
    expect(sceneHost.destroy).toHaveBeenCalledOnce()
  })
})
