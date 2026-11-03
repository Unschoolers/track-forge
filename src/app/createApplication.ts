export type AppMode = 'home' | 'editor' | 'race'

export interface SceneHost {
  start(mode: AppMode): void
  destroy(): void
}

export interface UiHost {
  mount(): void
  destroy(): void
}

export interface ApplicationDependencies {
  readonly sceneHost: SceneHost
  readonly uiHost: UiHost
}

export interface TrackForgeApplication {
  start(): void
  destroy(): void
}

/**
 * Owns application lifetime without knowing which rendering technologies back
 * the injected hosts. This is deliberately the only coordination needed during
 * startup; feature commands are added through the application controller.
 */
export function createApplication({
  sceneHost,
  uiHost,
}: ApplicationDependencies): TrackForgeApplication {
  let started = false
  let destroyed = false

  return {
    start(): void {
      if (started || destroyed) {
        return
      }

      started = true
      uiHost.mount()
      sceneHost.start('home')
    },

    destroy(): void {
      if (destroyed) {
        return
      }

      destroyed = true
      sceneHost.destroy()
      uiHost.destroy()
    },
  }
}
