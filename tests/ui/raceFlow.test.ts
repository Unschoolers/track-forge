import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppCommand, AppSnapshot } from '@/application/appState'
import type {
  RaceSessionPort,
  RaceSessionSnapshot,
} from '@/application/race/raceSession'
import { RaceSession } from '@/application/race/raceSession'
import type { RaceStep } from '@/domain/race/raceEngine'
import type { RaceControlsPort } from '@/application/ports/input'
import { createEditorState } from '@/domain/editor/editorState'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { DomUiHost } from '@/ui/uiHost'
import { RaceInputController } from '@/phaser/input/raceInput'
import { bindRacePointer, type RacePointerBinding } from '@/phaser/input/racePointer'

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

const hosts: DomUiHost[] = []
const bindings: RacePointerBinding[] = []

afterEach(() => {
  for (const binding of bindings.splice(0)) binding.destroy()
  for (const host of hosts.splice(0)) host.destroy()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function requiredElement(parent: ParentNode, selector: string): HTMLElement {
  const found = parent.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`Missing element: ${selector}`)
  return found
}

function pointer(type: string, id: number, x = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: id },
    clientX: { value: x },
  })
  return event
}

function setup(providedControls?: RaceControlsPort, providedSession?: RaceSessionPort) {
  const root = document.createElement('div')
  document.body.append(root)
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
  const mockSession: RaceSessionPort = {
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
  const raceSession = providedSession ?? mockSession
  const controls: RaceControlsPort = providedControls ?? {
    snapshot: vi.fn(() => ({
      steering: 0,
      throttle: 1,
      braking: false,
    })),
    setKeyboard: vi.fn(),
    setPedalKeyboard: vi.fn(),
    beginSteeringButton: vi.fn(),
    setSteeringButtonKeyboard: vi.fn(),
    beginSteering: vi.fn(),
    updateSteering: vi.fn(),
    beginBrake: vi.fn(),
    beginThrottle: vi.fn(),
    endPointer: vi.fn(),
    onReset: vi.fn(() => () => undefined),
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
  hosts.push(host)
  return {
    root,
    host,
    controller,
    controls,
    updateApp: (snapshot: AppSnapshot) => appListener?.(snapshot),
    updateRace: (snapshot: RaceSessionSnapshot) => {
      race = snapshot
      raceListener?.(snapshot)
    },
  }
}

function recoverySession() {
  let finishing = false
  const step: RaceStep = (state) => ({
    state: {
      ...state,
      phase: finishing ? 'finished' : 'running',
      elapsed: 23,
      vehicles: state.vehicles.map((vehicle) => vehicle.player
        ? { ...vehicle, x: vehicle.x + 1000, y: vehicle.y + 1000, speed: 20, lap: 1, nextSector: 2, damage: 2 }
        : vehicle),
    },
    events: finishing ? [{ type: 'race-finished', reason: 'water' }] : [],
  })
  const session = new RaceSession({
    scoreStore: { forTrack: () => [], record: () => false, removeTrack: () => false },
    random: { next: () => 0.5 },
    feedback: { unlock() {}, setEnabled() {}, handle() {}, silenceContinuous() {}, destroy() {} },
    step,
  })
  session.start(track, { car: 'blue', difficulty: 'normal', laps: 3 })
  return { session, finish: () => { finishing = true } }
}

describe('race UI flow', () => {
  it('recovers on touch and clears steering, braking, and their feedback', () => {
    const controls = new RaceInputController()
    const { session } = recoverySession()
    session.advance(3.7, controls.snapshot())
    session.advance(1 / 60, controls.snapshot())
    const { root } = setup(controls, session)
    const pad = requiredElement(root, '[data-race-steering]')
    const knob = requiredElement(pad, '.steering-thumb')
    const brake = requiredElement(root, '[data-action="brake"]')
    const recover = requiredElement(root, 'button[data-action="recover"]') as HTMLButtonElement
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    bindings.push(bindRacePointer(canvas, 'steering', controls))

    expect(recover.textContent).toBe('RECOVER')
    expect(recover.disabled).toBe(false)
    canvas.dispatchEvent(pointer('pointerdown', 21, 800))
    canvas.dispatchEvent(pointer('pointermove', 21, 848))
    pad.dispatchEvent(pointer('pointerdown', 22, 100))
    pad.dispatchEvent(pointer('pointermove', 22, 148))
    brake.dispatchEvent(pointer('pointerdown', 23))
    controls.setKeyboard('ArrowDown', true)
    expect(controls.snapshot()).toMatchObject({ steering: 1, braking: true })

    const before = session.snapshot()
    recover.dispatchEvent(pointer('pointerdown', 24))
    recover.dispatchEvent(pointer('pointerup', 24))
    expect(session.snapshot()).toBe(before)
    recover.click()
    const after = session.snapshot()
    expect(after.state?.vehicles[0]?.x).not.toBe(before.state?.vehicles[0]?.x)
    expect(after.state?.vehicles[0]).toMatchObject({ speed: 0, lap: 1, nextSector: 2, damage: 2 })
    expect(after.telemetry).toMatchObject({ elapsed: 23, lap: 1, damage: 2 })
    expect(controls.snapshot()).toMatchObject({ steering: 0, braking: false })
    expect(pad.getAttribute('aria-valuenow')).toBe('0.00')
    expect(knob.style.transform).toBe('translateX(0px)')
    expect(brake.classList.contains('pressed')).toBe(false)

    canvas.dispatchEvent(pointer('pointermove', 21, 752))
    pad.dispatchEvent(pointer('pointermove', 22, 52))
    expect(controls.snapshot()).toMatchObject({ steering: 0, braking: false })
    canvas.dispatchEvent(pointer('pointerdown', 21, 800))
    canvas.dispatchEvent(pointer('pointermove', 21, 752))
    expect(controls.snapshot().steering).toBe(-1)
    canvas.dispatchEvent(pointer('pointerup', 21))
    pad.dispatchEvent(pointer('pointerdown', 22, 100))
    pad.dispatchEvent(pointer('pointermove', 22, 52))
    expect(controls.snapshot().steering).toBe(-1)
  })

  it('disables and rejects recovery during countdown, pause, and after finish', () => {
    const controls = new RaceInputController()
    const { session, finish } = recoverySession()
    const { root } = setup(controls, session)
    const recover = requiredElement(root, 'button[data-action="recover"]') as HTMLButtonElement
    const assertRejected = () => {
      expect(recover.disabled).toBe(true)
      controls.setKeyboard('a', true)
      controls.setKeyboard(' ', true)
      const before = session.snapshot()
      recover.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(session.snapshot()).toBe(before)
      expect(controls.snapshot()).toMatchObject({ steering: -1, braking: true })
      controls.reset()
    }
    assertRejected()
    session.advance(3.7, controls.snapshot())
    session.advance(1 / 60, controls.snapshot())
    expect(recover.disabled).toBe(false)
    session.setPaused(true)
    assertRejected()
    session.setPaused(false)
    expect(recover.disabled).toBe(false)
    finish()
    session.advance(1 / 60, controls.snapshot())
    assertRejected()
  })

  it('patches live telemetry without replacing the race screen', () => {
    const { root, updateRace } = setup()
    const screen = root.querySelector('[data-screen="race"]')

    expect(root.querySelector('[data-race-position]')?.textContent).toBe('2/4')
    expect(root.querySelector('[data-race-lap]')?.textContent).toBe('2/3')
    expect(root.querySelector('[data-race-time]')?.textContent).toBe(
      '01:05.432',
    )
    expect(requiredElement(root, '[aria-label="Vehicle damage"]').hidden).toBe(true)
    expect(requiredElement(root, '[data-race-lap-times]').hidden).toBe(true)

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

  it('shows the finished best lap and damage only where they are relevant', () => {
    const { root, updateRace } = setup()
    updateRace({
      ...raceSnapshot({ currentLapTime: 9.5, bestLapTime: 15.25 }),
      setup: { car: 'blue', difficulty: 'normal', laps: 3, handling: 'simulation' },
    })
    expect(requiredElement(root, '[aria-label="Vehicle damage"]').hidden).toBe(false)
    expect(requiredElement(root, '[data-race-damage]').textContent).toBe('2/5')
    expect(requiredElement(root, '[data-race-lap-times]').textContent).toBe('BEST 00:15.250')

    updateRace({
      ...raceSnapshot({ bestLapTime: 15.25, ghostGap: -0.42 }),
      setup: { car: 'blue', difficulty: 'normal', laps: 3, mode: 'ghost' },
      ghostTime: 45,
    })
    expect(requiredElement(root, '[aria-label="Vehicle damage"]').hidden).toBe(true)
    expect(requiredElement(root, '[data-race-position]').textContent).toBe('00:45.000')
    expect(requiredElement(root, '[data-race-ghost-gap]').textContent).toBe('GAP −00:00.420')
  })

  it('keeps the final lap notice visible when an overtake follows it', () => {
    const { root, updateRace } = setup()
    const banner = requiredElement(root, '.race-event-banner')
    updateRace(raceSnapshot({ lap: 2, position: 1 }))
    expect(banner.textContent).toBe('FINAL LAP!')
    updateRace(raceSnapshot({ lap: 2, position: 2 }))
    updateRace(raceSnapshot({ lap: 2, position: 1 }))
    expect(banner.textContent).toBe('FINAL LAP!')
  })

  it('exposes separate simulation pedals and releases each touch independently', () => {
    const controls = new RaceInputController()
    const { root, updateRace } = setup(controls)
    const simulation = raceSnapshot()
    const simulationSetup = { car: 'blue' as const, difficulty: 'normal' as const, laps: 3, handling: 'simulation' as const }
    updateRace({ ...simulation, setup: simulationSetup })
    const throttle = requiredElement(root, '[data-action="throttle"]')
    const brake = requiredElement(root, '[data-action="brake"]')
    const pad = requiredElement(root, '[data-race-steering]')
    expect(throttle.hidden).toBe(false)
    pad.dispatchEvent(pointer('pointerdown', 1, 100))
    window.dispatchEvent(pointer('pointermove', 1, 148))
    throttle.dispatchEvent(pointer('pointerdown', 2))
    brake.dispatchEvent(pointer('pointerdown', 3))
    expect(controls.snapshot()).toEqual({ steering: 1, throttle: 1, braking: true })
    window.dispatchEvent(pointer('pointercancel', 2))
    expect(controls.snapshot()).toEqual({ steering: 1, throttle: 0, braking: true })
    expect(throttle.classList.contains('pressed')).toBe(false)
    throttle.dispatchEvent(pointer('pointerdown', 4))
    updateRace({ ...simulation, setup: simulationSetup,
      state: { paused: true, vehicles: [] } as unknown as RaceSessionSnapshot['state'] })
    expect(controls.snapshot()).toEqual({ steering: 0, throttle: 0, braking: false })
    updateRace(raceSnapshot())
    expect(throttle.hidden).toBe(true)
    expect(controls.snapshot()).toEqual({ steering: 0, throttle: 0, braking: false })
  })

  it('keeps held gas through GO but clears controls on pause and resume', () => {
    const controls = new RaceInputController()
    const { root, updateRace } = setup(controls)
    const raceSetup = { car: 'blue' as const, difficulty: 'normal' as const, laps: 3, handling: 'simulation' as const }
    const countdown = raceSnapshot({ phase: 'countdown' })
    updateRace({ ...countdown, setup: raceSetup })
    requiredElement(root, '[data-action="throttle"]').dispatchEvent(pointer('pointerdown', 51))
    updateRace({ ...raceSnapshot(), setup: raceSetup })
    expect(controls.snapshot().throttle).toBe(1)
    updateRace({ ...raceSnapshot(), setup: raceSetup, state: { paused: true, vehicles: [] } as unknown as RaceSessionSnapshot['state'] })
    expect(controls.snapshot().throttle).toBe(0)
    controls.setKeyboard('w', true)
    updateRace({ ...raceSnapshot(), setup: raceSetup })
    expect(controls.snapshot().throttle).toBe(0)
  })

  it('holds focused pedal with Enter or Space without sending Space to global braking', () => {
    const controls = new RaceInputController()
    const { root, updateRace } = setup(controls)
    const snapshot = raceSnapshot()
    updateRace({ ...snapshot, setup: { car: 'blue', difficulty: 'normal', laps: 3, handling: 'simulation' } })
    const throttle = requiredElement(root, '[data-action="throttle"]')
    const brake = requiredElement(root, '[data-action="brake"]')
    const globalKey = vi.fn()
    window.addEventListener('keydown', globalKey)
    try {
      throttle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
      expect(controls.snapshot()).toMatchObject({ throttle: 1, braking: false })
      expect(globalKey).not.toHaveBeenCalled()
      throttle.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }))
      expect(controls.snapshot().throttle).toBe(0)
      throttle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(controls.snapshot().throttle).toBe(1)
      throttle.dispatchEvent(new FocusEvent('blur'))
      expect(controls.snapshot().throttle).toBe(0)
      throttle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }))
      expect(controls.snapshot().throttle).toBe(0)
      brake.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(controls.snapshot().braking).toBe(true)
      brake.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(controls.snapshot().braking).toBe(false)
    } finally {
      window.removeEventListener('keydown', globalKey)
    }
  })

  it('binds steering, brake, pause, and cancellation to shared controls', () => {
    const { root, controls, controller } = setup()
    const steering = root.querySelector<HTMLElement>('[data-race-steering]')
    const brake = root.querySelector<HTMLElement>('[data-action="brake"]')
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

    expect(controls.beginSteering).toHaveBeenCalledWith(7, 0)
    expect(controls.updateSteering).toHaveBeenCalledWith(7, -1)
    expect(controls.endPointer).toHaveBeenCalledWith(7)
    expect(controls.beginBrake).toHaveBeenCalledWith(8)
    expect(controls.endPointer).toHaveBeenCalledWith(8)
    expect(controller.dispatch).toHaveBeenCalledWith({ type: 'pause-race' })
  })

  it('steers relative to touchdown with a dead zone and visible knob feedback', () => {
    const controls = new RaceInputController()
    const { root } = setup(controls)
    const pad = requiredElement(root, '[data-race-steering]')
    const knob = requiredElement(pad, '.steering-thumb')

    pad.dispatchEvent(pointer('pointerdown', 1, 150))
    expect(controls.snapshot().steering).toBe(0)
    expect(pad.getAttribute('aria-valuenow')).toBe('0.00')
    pad.dispatchEvent(pointer('pointermove', 1, 153))
    expect(controls.snapshot().steering).toBe(0)
    pad.dispatchEvent(pointer('pointermove', 1, 174))
    expect(controls.snapshot().steering).toBeGreaterThan(0.25)
    expect(controls.snapshot().steering).toBeLessThan(0.4)
    pad.dispatchEvent(pointer('pointermove', 1, 198))
    expect(controls.snapshot().steering).toBe(1)
    expect(knob.style.transform).toBe('translateX(48px)')
    expect(pad.getAttribute('aria-valuenow')).toBe('1.00')
    pad.dispatchEvent(pointer('pointermove', 1, 102))
    expect(controls.snapshot().steering).toBe(-1)
    expect(knob.style.transform).toBe('translateX(-48px)')
    pad.dispatchEvent(pointer('pointerup', 1))
    expect(controls.snapshot().steering).toBe(0)
    expect(knob.style.transform).toBe('translateX(0px)')
  })

  it('hands off overlapping steering touches and brakes only on the brake button', () => {
    const controls = new RaceInputController()
    const { root } = setup(controls)
    const pad = requiredElement(root, '[data-race-steering]')
    const knob = requiredElement(pad, '.steering-thumb')
    const brake = requiredElement(root, '[data-action="brake"]')

    pad.dispatchEvent(pointer('pointerdown', 1, 120))
    pad.dispatchEvent(pointer('pointermove', 1, 168))
    pad.dispatchEvent(pointer('pointerdown', 2, 200))
    pad.dispatchEvent(pointer('pointermove', 2, 152))
    expect(controls.snapshot()).toMatchObject({ steering: 1, braking: false })
    expect(knob.style.transform).toBe('translateX(48px)')
    brake.dispatchEvent(pointer('pointerdown', 3))
    brake.dispatchEvent(pointer('pointerdown', 4))
    expect(controls.snapshot()).toMatchObject({ steering: 1, braking: true })
    brake.dispatchEvent(pointer('lostpointercapture', 3))
    expect(controls.snapshot().braking).toBe(true)
    expect(brake.classList.contains('pressed')).toBe(true)
    pad.dispatchEvent(pointer('lostpointercapture', 1))
    expect(controls.snapshot()).toMatchObject({ steering: -1, braking: true })
    expect(knob.style.transform).toBe('translateX(-48px)')
    brake.dispatchEvent(pointer('lostpointercapture', 4))
    pad.dispatchEvent(pointer('lostpointercapture', 2))
    expect(controls.snapshot()).toMatchObject({ steering: 0, braking: false })
    expect(brake.classList.contains('pressed')).toBe(false)
  })

  it('clears active controls on focus loss, resize, and HUD destruction', () => {
    const controls = new RaceInputController()
    const { root, host } = setup(controls)
    const pad = requiredElement(root, '[data-race-steering]')
    const brake = requiredElement(root, '[data-action="brake"]')
    for (const event of ['blur', 'resize']) {
      pad.dispatchEvent(pointer('pointerdown', 1, 100))
      pad.dispatchEvent(pointer('pointermove', 1, 148))
      brake.dispatchEvent(pointer('pointerdown', 2))
      window.dispatchEvent(new Event(event))
      expect(controls.snapshot()).toMatchObject({ steering: 0, braking: false })
      expect(brake.classList.contains('pressed')).toBe(false)
      expect(pad.getAttribute('aria-valuenow')).toBe('0.00')
    }
    pad.dispatchEvent(pointer('pointerdown', 3, 100))
    pad.dispatchEvent(pointer('pointermove', 3, 148))
    brake.dispatchEvent(pointer('pointerdown', 4))
    host.destroy()
    expect(controls.snapshot()).toMatchObject({ steering: 0, braking: false })
  })

  it('uses window events if capture fails and releases outside the pad', () => {
    const controls = new RaceInputController()
    const { root } = setup(controls)
    const pad = requiredElement(root, '[data-race-steering]')
    Object.defineProperty(pad, 'setPointerCapture', { value: () => { throw new Error('capture unavailable') } })
    pad.dispatchEvent(pointer('pointerdown', 11, 300))
    window.dispatchEvent(pointer('pointermove', 11, 348))
    expect(controls.snapshot().steering).toBe(1)
    window.dispatchEvent(pointer('pointerup', 11))
    expect(controls.snapshot().steering).toBe(0)
  })

  it('releases an uncaptured steering pointer when it leaves the viewport', () => {
    const controls = new RaceInputController()
    const { root } = setup(controls)
    const pad = requiredElement(root, '[data-race-steering]')
    const knob = requiredElement(pad, '.steering-thumb')
    pad.dispatchEvent(pointer('pointerdown', 11, 300))
    window.dispatchEvent(pointer('pointermove', 11, 348))
    const leave = pointer('pointerout', 11)
    Object.defineProperty(leave, 'relatedTarget', { value: null })
    window.dispatchEvent(leave)
    expect(controls.snapshot().steering).toBe(0)
    expect(knob.style.transform).toBe('translateX(0px)')
  })

  it('keeps a captured steering pointer active when it leaves the viewport', () => {
    const controls = new RaceInputController()
    const { root } = setup(controls)
    const pad = requiredElement(root, '[data-race-steering]')
    Object.defineProperties(pad, {
      setPointerCapture: { value: () => undefined },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: () => undefined },
    })
    pad.dispatchEvent(pointer('pointerdown', 11, 300))
    window.dispatchEvent(pointer('pointermove', 11, 348))
    const leave = pointer('pointerout', 11)
    Object.defineProperty(leave, 'relatedTarget', { value: null })
    window.dispatchEvent(leave)
    expect(controls.snapshot().steering).toBe(1)
    window.dispatchEvent(pointer('pointerup', 11))
    expect(controls.snapshot().steering).toBe(0)
  })

  it('clears feedback even when capture release races pointer removal', () => {
    const controls = new RaceInputController()
    const { root } = setup(controls)
    const pad = requiredElement(root, '[data-race-steering]')
    const knob = requiredElement(pad, '.steering-thumb')
    Object.defineProperties(pad, {
      setPointerCapture: { value: () => undefined },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: () => { throw new Error('pointer already gone') } },
    })
    pad.dispatchEvent(pointer('pointerdown', 11, 300))
    pad.dispatchEvent(pointer('pointermove', 11, 348))
    pad.dispatchEvent(pointer('pointerup', 11))
    expect(controls.snapshot().steering).toBe(0)
    expect(knob.style.transform).toBe('translateX(0px)')
  })

  it('releases steering and braking when the document becomes hidden', () => {
    const controls = new RaceInputController()
    const { root } = setup(controls)
    const pad = requiredElement(root, '[data-race-steering]')
    const brake = requiredElement(root, '[data-action="brake"]')
    pad.dispatchEvent(pointer('pointerdown', 11, 300))
    pad.dispatchEvent(pointer('pointermove', 11, 348))
    brake.dispatchEvent(pointer('pointerdown', 12))
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(controls.snapshot()).toMatchObject({ steering: 0, braking: false })
    expect(brake.classList.contains('pressed')).toBe(false)
  })

  it('shares canvas steering and HUD braking with deterministic cross-surface handoff', () => {
    const controls = new RaceInputController()
    const { root, updateRace } = setup(controls)
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    bindings.push(bindRacePointer(canvas, 'steering', controls))
    const pad = requiredElement(root, '[data-race-steering]')
    const knob = requiredElement(pad, '.steering-thumb')
    const brake = requiredElement(root, '[data-action="brake"]')

    canvas.dispatchEvent(pointer('pointerdown', 21, 800))
    canvas.dispatchEvent(pointer('pointermove', 21, 848))
    pad.dispatchEvent(pointer('pointerdown', 22, 130))
    pad.dispatchEvent(pointer('pointermove', 22, 82))
    expect(controls.snapshot()).toMatchObject({ steering: 1, braking: false })
    brake.dispatchEvent(pointer('pointerdown', 23))
    expect(controls.snapshot()).toMatchObject({ steering: 1, braking: true })
    expect(knob.style.transform).toBe('translateX(48px)')
    canvas.dispatchEvent(pointer('pointerup', 21))
    updateRace(raceSnapshot())
    expect(controls.snapshot()).toMatchObject({ steering: -1, braking: true })
    expect(knob.style.transform).toBe('translateX(-48px)')
    brake.dispatchEvent(pointer('pointerup', 23))
    pad.dispatchEvent(pointer('pointercancel', 22))
    expect(controls.snapshot()).toMatchObject({ steering: 0, braking: false })
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
    root.querySelector<HTMLButtonElement>('[data-action="change-track"]')?.click()
    expect(controller.dispatch).toHaveBeenCalledWith({ type: 'open-track-library', purpose: 'race' })
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
