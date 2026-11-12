import { vi } from 'vitest'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import type { UiRuntime } from '@/ui/uiHost'

export function createUiRuntime(): UiRuntime {
  return {
    geometry: new TrackGeometryService(),
    raceSession: {
      start: vi.fn(),
      restart: vi.fn(),
      resetPlayer: vi.fn(),
      setPaused: vi.fn(),
      advance: vi.fn(),
      snapshot: () => ({
        track: null,
        setup: null,
        state: null,
        telemetry: {
          phase: 'countdown',
          countdown: 3.7,
          elapsed: 0,
          position: 1,
          vehicleCount: 4,
          lap: 0,
          totalLaps: 3,
          damage: 0,
          damageLimit: 5,
        },
        standings: [],
        result: null,
      }),
      subscribe: vi.fn(() => () => undefined),
      destroy: vi.fn(),
    },
    raceControls: {
      snapshot: vi.fn(() => ({
        steering: 0,
        throttle: 1,
        braking: false,
      })),
      setKeyboard: vi.fn(),
      setPedalKeyboard: vi.fn(),
      beginSteering: vi.fn(),
      updateSteering: vi.fn(),
      beginBrake: vi.fn(),
      beginThrottle: vi.fn(),
      endPointer: vi.fn(),
      onReset: vi.fn(() => () => undefined),
      reset: vi.fn(),
    },
    feedback: {
      unlock: vi.fn(),
      setEnabled: vi.fn(),
      handle: vi.fn(),
      silenceContinuous: vi.fn(),
      destroy: vi.fn(),
    },
  }
}
