import { describe, expect, it, vi } from 'vitest'
import type { AppCommand, AppSnapshot } from '@/application/appState'
import type {
  RaceSessionPort,
  RaceSessionSnapshot,
} from '@/application/race/raceSession'
import type { RaceControlsPort } from '@/application/ports/input'
import { createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { DomUiHost } from '@/ui/uiHost'

const track = createStarterTrack(asTrackId('race-flow'), 1)

function appSnapshot(
  overlay: AppSnapshot['overlay'] = { type: 'none' },
): AppSnapshot {
  return {
    mode: 'race',
    paused: overlay.type === 'pause',
    overlay,
    tracks: [track],
    currentTrack: track,
    editor: createEditorState(track.points, track.trees),
    editorUi: {
      tool: 'draw',
      surface: 'street',
      structure: 'overpass',
      terrainBrush: { mode: 'raise', radius: 48 },
      grid: false,
      cameraRequest: null,
      selectedCrossing: null,
      selectedPoint: null,
    },
    preferences: {
      car: 'blue',
      difficulty: 'normal',
      lighting: 'day',
      audioEnabled: true,
      hapticsEnabled: true,
      dynamicZoomEnabled: true,
    },
    scoresByTrack: {},
    notice: null,
  }
}

function raceSnapshot(
  overrides: Partial<RaceSessionSnapshot['telemetry']> = {},
): RaceSessionSnapshot {
  return {
    track,
    setup: { car: 'blue', difficulty: 'normal', laps: 3 },
    state: null,
    telemetry: {
      phase: 'running',
      countdown: 0,
      elapsed: 65.432,
      position: 2,
      vehicleCount: 4,
      lap: 1,
      totalLaps: 3,
      damage: 2,
      damageLimit: 5,
      ...overrides,
    },
    standings: [],
    result: null,
  }
}

function setup() {
  const root = document.createElement('div')
  let appListener: ((snapshot: AppSnapshot) => void) | undefined
  let raceListener: ((snapshot: RaceSessionSnapshot) => void) | undefined
  let race = raceSnapshot()
  const controller = {
    snapshot: () => appSnapshot(),
    dispatch: vi.fn<(command: AppCommand) => void>(),
    subscribe: vi.fn((listener: (snapshot: AppSnapshot) => void) => {
      appListener = listener
      return () => {
        appListener = undefined
      }
    }),
  }
  const raceSession: RaceSessionPort = {
    start: vi.fn(),
    restart: vi.fn(),
    resetPlayer: vi.fn(),
    setPaused: vi.fn(),
    advance: vi.fn(),
    snapshot: () => race,
    subscribe: vi.fn((listener) => {
      raceListener = listener
      return () => {
        raceListener = undefined
      }
    }),
    destroy: vi.fn(),
  }
  const controls: RaceControlsPort = {
    snapshot: vi.fn(() => ({
      steering: 0,
      throttle: 1,
      braking: false,
    })),
    setKeyboard: vi.fn(),
    beginSteering: vi.fn(),
    updateSteering: vi.fn(),
    beginBrake: vi.fn(),
    endPointer: vi.fn(),
    reset: vi.fn(),
  }
  const host = new DomUiHost(root, controller, {
    raceSession,
    raceControls: controls,
    geometry: new TrackGeometryService(),
    feedback: {
      unlock: vi.fn(),
      setEnabled: vi.fn(),
      handle: vi.fn(),
      silenceContinuous: vi.fn(),
      destroy: vi.fn(),
    },
  })
  host.mount()
  return {
    root,
    controller,
    controls,
    updateApp: (snapshot: AppSnapshot) => appListener?.(snapshot),
    updateRace: (snapshot: RaceSessionSnapshot) => {
      race = snapshot
      raceListener?.(snapshot)
    },
  }
}

describe('race UI flow', () => {
  it('patches live telemetry without replacing the race screen', () => {
    const { root, updateRace } = setup()
    const screen = root.querySelector('[data-screen="race"]')

    expect(root.querySelector('[data-race-position]')?.textContent).toBe('2/4')
    expect(root.querySelector('[data-race-lap]')?.textContent).toBe('2/3')
    expect(root.querySelector('[data-race-time]')?.textContent).toBe(
      '01:05.432',
    )
    expect(root.querySelector('[data-race-damage]')?.textContent).toBe('2/5')

    updateRace(
      raceSnapshot({
        phase: 'countdown',
        countdown: 2.2,
        elapsed: 0,
        position: 1,
      }),
    )
    expect(root.querySelector('[data-screen="race"]')).toBe(screen)
    expect(root.querySelector('[data-race-countdown]')?.textContent).toBe('3')
  })

  it('binds steering, brake, pause, and cancellation to shared controls', () => {
    const { root, controls, controller } = setup()
    const steering = root.querySelector<HTMLElement>('[data-race-steering]')
    const brake = root.querySelector<HTMLElement>('[data-action="brake"]')
    const pointer = (type: string, id: number, x = 0): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, {
        pointerId: { value: id },
        clientX: { value: x },
      })
      return event
    }
    vi.spyOn(steering as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 60,
      top: 0,
      right: 200,
      bottom: 60,
      left: 0,
      toJSON: () => ({}),
    })

    steering?.dispatchEvent(pointer('pointerdown', 7, 150))
    steering?.dispatchEvent(pointer('pointermove', 7, 40))
    steering?.dispatchEvent(pointer('pointercancel', 7))
    brake?.dispatchEvent(pointer('pointerdown', 8))
    brake?.dispatchEvent(pointer('pointerup', 8))
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')?.click()

    expect(controls.beginSteering).toHaveBeenCalledWith(7, 0.5)
    expect(controls.updateSteering).toHaveBeenCalledWith(7, -0.6)
    expect(controls.endPointer).toHaveBeenCalledWith(7)
    expect(controls.beginBrake).toHaveBeenCalledWith(8)
    expect(controls.endPointer).toHaveBeenCalledWith(8)
    expect(controller.dispatch).toHaveBeenCalledWith({ type: 'pause-race' })
  })

  it('renders authoritative results with retry and edit actions', () => {
    const { root, controller, updateApp, updateRace } = setup()
    updateRace({
      ...raceSnapshot({ phase: 'finished', elapsed: 62.5 }),
      result: {
        outcome: 'finished',
        trackId: track.id,
        trackName: track.name,
        playerPlace: 1,
        playerTime: 62.5,
        playerWrecked: false,
        newRecord: true,
        standings: [
          {
            id: 'player',
            car: 'blue',
            player: true,
            place: 1,
            finishTime: 62.5,
            wrecked: false,
            lap: 3,
          },
        ],
        highScores: [
          {
            time: 62.5,
            car: 'blue',
            difficulty: 'normal',
            recordedAt: 10,
          },
        ],
      },
    })
    updateApp({ ...appSnapshot({ type: 'results' }), paused: true })

    expect(root.querySelector('[data-modal="results"]')?.textContent).toContain(
      'NEW RECORD',
    )
    expect(root.querySelector('[data-results-standings]')?.textContent).toContain(
      '01:02.500',
    )
    root.querySelector<HTMLButtonElement>('[data-action="retry-race"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-action="edit-race-track"]')
      ?.click()

    expect(controller.dispatch).toHaveBeenCalledWith({ type: 'restart-race' })
    expect(controller.dispatch).toHaveBeenCalledWith({ type: 'open-editor' })
  })

  it('shows the exact water result headline', () => {
    const { root, updateApp, updateRace } = setup()
    updateRace({
      ...raceSnapshot({ phase: 'finished' }),
      result: {
        outcome: 'water',
        trackId: track.id,
        trackName: track.name,
        playerPlace: 4,
        playerTime: null,
        playerWrecked: false,
        newRecord: false,
        standings: [],
        highScores: [],
      },
    })
    updateApp({ ...appSnapshot({ type: 'results' }), paused: true })

    expect(
      root.querySelector('[data-modal="results"] .modal-title')?.textContent,
    ).toBe('SUNK')
  })
})
