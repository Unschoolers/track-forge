import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    BlendModes: { ADD: 1 },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  },
}))
vi.mock('@/phaser/rendering/nightRenderer', () => ({ renderNightLights: vi.fn(), renderNightShade: vi.fn() }))
vi.mock('@/phaser/rendering/trackRenderer', () => ({
  renderTrackGeometryBase: vi.fn(), renderTrackGeometryBridgeOverlay: vi.fn(), renderTrackGeometryStructureUnderlay: vi.fn(),
}))
vi.mock('@/phaser/rendering/lampPostRenderer', () => ({ buildLampPosts: () => [], renderLampPosts: vi.fn() }))
vi.mock('@/phaser/rendering/treeRenderer', () => ({ renderTrees: vi.fn() }))
vi.mock('@/phaser/rendering/terrainRenderer', () => ({ renderTerrain: vi.fn() }))

import { RaceInputController } from '@/phaser/input/raceInput'
import { RaceScene } from '@/phaser/scenes/RaceScene'
import { RaceSession, type RaceSessionPort } from '@/application/race/raceSession'
import type { RaceStep } from '@/domain/race/raceEngine'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { createRaceHud } from '@/ui/screens/raceHud'
import { bindRacePointer } from '@/phaser/input/racePointer'

function pointer(type: string, id: number, clientX = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, { pointerId: { value: id }, clientX: { value: clientX } })
  return event
}

afterEach(() => document.body.replaceChildren())

function createScene(controls: RaceInputController, session: Pick<RaceSessionPort, 'snapshot'>) {
  const canvas = document.createElement('canvas')
  canvas.width = 2000
  canvas.style.width = '500px'
  document.body.append(canvas)
  const controller = { snapshot: () => ({ currentTrack: { trees: [] }, preferences: { lighting: 'day' } }), dispatch: vi.fn() }
  const geometry = { get: () => ({ path: { terrainSurface: {} } }) }
  const graphics = { setDepth() { return this }, setBlendMode() { return this } }
  let shutdown: (() => void) | undefined
  const scene = new RaceScene(controller as never, session as never, controls, geometry as never)
  Object.assign(scene, {
    game: { canvas },
    add: { graphics: () => graphics },
    cameras: { main: { setBackgroundColor: vi.fn() } },
    events: { once: (_event: string, callback: () => void, context: unknown) => { shutdown = callback.bind(context) } },
    input: { on: vi.fn(), off: vi.fn() },
    scale: { width: 2000 },
  })
  scene.create()
  return { canvas, shutdown: () => shutdown?.() }
}

function recoverySession() {
  let finishing = false
  const step: RaceStep = (state) => ({
    state: {
      ...state,
      phase: finishing ? 'finished' : 'running',
      vehicles: state.vehicles.map((vehicle) => vehicle.player
        ? { ...vehicle, x: vehicle.x + 1000, speed: 20, lap: 1, damage: 2 }
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
  session.start(createStarterTrack(asTrackId('keyboard-recovery'), 1), { car: 'blue', difficulty: 'normal', laps: 3 })
  return { session, finish: () => { finishing = true } }
}

describe('race canvas steering', () => {
  it.each(['pointercancel', 'lostpointercapture'])(
    'cancels only the affected finger on %s', (eventType) => {
      const controls = new RaceInputController()
      const { canvas, shutdown } = createScene(controls, { snapshot: () => ({ state: { vehicles: [] } }) } as never)
      const brake = document.createElement('button')
      document.body.append(brake)
      const binding = bindRacePointer(brake, 'brake', controls)
      try {
        canvas.dispatchEvent(pointer('pointerdown', 201, 100))
        canvas.dispatchEvent(pointer('pointermove', 201, 148))
        brake.dispatchEvent(pointer('pointerdown', 202, 480))
        brake.dispatchEvent(pointer(eventType, 202, 480))
        expect(controls.snapshot()).toMatchObject({ steering: 1, braking: false })
        brake.dispatchEvent(pointer('pointerdown', 203, 480))
        canvas.dispatchEvent(pointer(eventType, 201, 148))
        expect(controls.snapshot()).toMatchObject({ steering: 0, braking: true })
      } finally { binding.destroy(); shutdown() }
    },
  )
  it.each(['steer-first', 'brake-first'])(
    'keeps steering responsive across the open playfield while braking (%s)', (order) => {
      const controls = new RaceInputController()
      const { canvas, shutdown } = createScene(controls, { snapshot: () => ({ state: { vehicles: [] } }) } as never)
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        value: () => ({ left: 0, width: 500, top: 0, height: 700 }),
      })
      const brake = document.createElement('button')
      document.body.append(brake)
      const binding = bindRacePointer(brake, 'brake', controls)
      const touch = (type: string, id: number, x: number): Event => {
        const event = pointer(type, id, x)
        Object.defineProperty(event, 'pointerType', { value: 'touch' })
        return event
      }
      try {
        if (order === 'brake-first') brake.dispatchEvent(touch('pointerdown', 102, 480))
        canvas.dispatchEvent(touch('pointerdown', 101, 350))
        canvas.dispatchEvent(touch('pointermove', 101, 398))
        if (order === 'steer-first') brake.dispatchEvent(touch('pointerdown', 102, 480))
        expect(controls.snapshot()).toMatchObject({ steering: 1, braking: true })
        // Releasing/reapplying Brake must not cancel the steering finger.
        brake.dispatchEvent(touch('pointerup', 102, 480))
        expect(controls.snapshot()).toMatchObject({ steering: 1, braking: false })
        brake.dispatchEvent(touch('pointerdown', 103, 480))
        canvas.dispatchEvent(touch('pointermove', 101, 302))
        expect(controls.snapshot()).toMatchObject({ steering: -1, braking: true })
        canvas.dispatchEvent(touch('pointerup', 101, 302))
        expect(controls.snapshot()).toMatchObject({ steering: 0, braking: true })
        // Regrab at the current thumb position while Brake remains held.
        canvas.dispatchEvent(touch('pointerdown', 104, 370))
        canvas.dispatchEvent(touch('pointermove', 104, 418))
        expect(controls.snapshot()).toMatchObject({ steering: 1, braking: true })
      } finally { binding.destroy(); shutdown() }
    },
  )
  it('uses CSS-pixel movement and releases on capture loss and scene shutdown', () => {
    const controls = new RaceInputController()
    const session = { snapshot: () => ({ state: { vehicles: [] } }) } as never
    const { canvas, shutdown } = createScene(controls, session)

    canvas.dispatchEvent(pointer('pointerdown', 21, 930))
    expect(controls.snapshot().steering).toBe(0)
    canvas.dispatchEvent(pointer('pointermove', 21, 978))
    expect(controls.snapshot().steering).toBe(1)
    canvas.dispatchEvent(pointer('lostpointercapture', 21))
    expect(controls.snapshot().steering).toBe(0)
    canvas.dispatchEvent(pointer('pointerdown', 22, 500))
    canvas.dispatchEvent(pointer('pointermove', 22, 452))
    expect(controls.snapshot().steering).toBe(-1)
    shutdown()
    expect(controls.snapshot().steering).toBe(0)
    canvas.dispatchEvent(pointer('pointerdown', 23, 500))
    canvas.dispatchEvent(pointer('pointermove', 23, 548))
    expect(controls.snapshot().steering).toBe(0)
  })

  it('keeps brake-button touches separate from canvas steering', () => {
    const controls = new RaceInputController()
    const session = { snapshot: () => ({ state: { vehicles: [] } }) } as never
    const { canvas, shutdown } = createScene(controls, session)
    const brake = document.createElement('button')
    document.body.append(brake)
    const brakeBinding = bindRacePointer(brake, 'brake', controls)
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 500, top: 0, height: 700 }),
    })
    const touch = (type: string, id: number, x: number): Event => {
      const event = pointer(type, id, x)
      Object.defineProperty(event, 'pointerType', { value: 'touch' })
      return event
    }
    try {
      brake.dispatchEvent(touch('pointerdown', 90, 450))
      brake.dispatchEvent(touch('pointermove', 90, 400))
      expect(controls.snapshot()).toMatchObject({ steering: 0, braking: true })
      canvas.dispatchEvent(touch('pointerdown', 91, 100))
      canvas.dispatchEvent(touch('pointermove', 91, 148))
      expect(controls.snapshot().steering).toBe(1)
      canvas.dispatchEvent(touch('pointerup', 91, 148))
      expect(controls.snapshot().steering).toBe(0)
    } finally {
      brakeBinding.destroy()
      shutdown()
    }
  })

  it('ignores keyboard recovery during countdown, pause, and after finish', () => {
    const controls = new RaceInputController()
    const { session, finish } = recoverySession()
    const { shutdown } = createScene(controls, session)
    const assertRejected = () => {
      controls.setKeyboard('a', true)
      controls.setKeyboard(' ', true)
      const before = session.snapshot()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
      expect(session.snapshot()).toBe(before)
      expect(controls.snapshot()).toMatchObject({ steering: -1, braking: true })
      controls.reset()
    }
    try {
      assertRejected()
      session.advance(3.7, controls.snapshot())
      session.advance(1 / 60, controls.snapshot())
      session.setPaused(true)
      assertRejected()
      session.setPaused(false)
      finish()
      session.advance(1 / 60, controls.snapshot())
      assertRejected()
    } finally {
      shutdown()
    }
  })

  it('recovers once on R and cancels a held canvas pointer', () => {
    const controls = new RaceInputController()
    const { session } = recoverySession()
    session.advance(3.7, controls.snapshot())
    session.advance(1 / 60, controls.snapshot())
    const { canvas, shutdown } = createScene(controls, session)
    const hud = createRaceHud(null as never, session, controls, { pause() {} })
    document.body.append(hud.element)
    try {
      const pad = hud.element.querySelector<HTMLElement>('[data-race-steering]')
      const brake = hud.element.querySelector<HTMLElement>('[data-action="brake"]')
      if (!pad || !brake) throw new Error('Missing race controls')
      canvas.dispatchEvent(pointer('pointerdown', 21, 100))
      canvas.dispatchEvent(pointer('pointermove', 21, 148))
      pad.dispatchEvent(pointer('pointerdown', 22, 100))
      pad.dispatchEvent(pointer('pointermove', 22, 148))
      brake.dispatchEvent(pointer('pointerdown', 23))
      controls.setKeyboard(' ', true)
      const before = session.snapshot()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R' }))
      expect(session.snapshot().state?.vehicles[0]?.x).not.toBe(before.state?.vehicles[0]?.x)
      expect(session.snapshot().state?.vehicles[0]).toMatchObject({ speed: 0, lap: 1, damage: 2 })
      expect(controls.snapshot()).toMatchObject({ steering: 0, braking: false })
      expect(pad.getAttribute('aria-valuenow')).toBe('0.00')
      expect(brake.classList.contains('pressed')).toBe(false)
      canvas.dispatchEvent(pointer('pointermove', 21, 52))
      expect(controls.snapshot().steering).toBe(0)
      pad.dispatchEvent(pointer('pointerdown', 22, 100))
      pad.dispatchEvent(pointer('pointermove', 22, 148))
      expect(controls.snapshot().steering).toBe(1)
      pad.dispatchEvent(pointer('pointerup', 22))
      canvas.dispatchEvent(pointer('pointerdown', 21, 100))
      canvas.dispatchEvent(pointer('pointermove', 21, 52))
      expect(controls.snapshot().steering).toBe(-1)
      const recovered = session.snapshot()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', repeat: true }))
      expect(session.snapshot()).toBe(recovered)
      expect(controls.snapshot().steering).toBe(-1)
    } finally {
      hud.destroy()
      shutdown()
    }
  })
})
