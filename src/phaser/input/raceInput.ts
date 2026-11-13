import { clamp } from '@/domain/geometry/math'
import type { DriverInput } from '@/domain/race/raceState'
import type { RaceControlsPort } from '@/application/ports/input'

/** Arcade keeps its automatic throttle; Simulation uses the held input. */
export function inputForHandling(input: DriverInput, handling: 'arcade' | 'simulation' | undefined): DriverInput {
  return handling === 'simulation' ? input : { ...input, throttle: 1 }
}

type PointerState =
  | { readonly role: 'steering'; steering: number }
  | { readonly role: 'button'; readonly direction: -1 | 1 }
  | { readonly role: 'brake' }
  | { readonly role: 'throttle' }

export class RaceInputController implements RaceControlsPort {
  private readonly pointers = new Map<number, PointerState>()
  private readonly steeringKeys = new Map<string, -1 | 1>()
  private readonly brakeKeys = new Set<string>()
  private readonly throttleKeys = new Set<string>()
  private activeSteeringPointer: number | undefined
  private readonly resetListeners = new Set<() => void>()

  snapshot(): DriverInput {
    const activePointer = this.activeSteeringPointer === undefined
      ? undefined
      : this.pointers.get(this.activeSteeringPointer)
    return {
      steering: activePointer?.role === 'steering'
        ? activePointer.steering
        : this.keyboardDirection(),
      throttle: this.throttleKeys.size > 0 ||
        [...this.pointers.values()].some((pointer) => pointer.role === 'throttle') ? 1 : 0,
      braking:
        this.brakeKeys.size > 0 ||
        [...this.pointers.values()].some((pointer) => pointer.role === 'brake'),
    }
  }

  private keyboardDirection(): number {
    // Most recently pressed direction wins; releasing it restores the held key.
    return [...this.steeringKeys.values()].at(-1) ?? 0
  }

  setKeyboard(key: string, pressed: boolean): void {
    const normalized = key.toLowerCase()
    if (['arrowleft', 'arrowright', 'a', 'd'].includes(normalized)) {
      this.steeringKeys.delete(normalized)
      if (pressed) this.steeringKeys.set(normalized, normalized === 'arrowleft' || normalized === 'a' ? -1 : 1)
    }
    if ([' ', 'arrowdown', 's'].includes(normalized)) {
      if (pressed) this.brakeKeys.add(normalized)
      else this.brakeKeys.delete(normalized)
    }
    if (['arrowup', 'w'].includes(normalized)) {
      if (pressed) this.throttleKeys.add(normalized)
      else this.throttleKeys.delete(normalized)
    }
  }

  setPedalKeyboard(pedal: 'brake' | 'throttle', key: string, pressed: boolean): void {
    const keys = pedal === 'brake' ? this.brakeKeys : this.throttleKeys
    const name = `pedal:${key}`
    if (pressed) keys.add(name)
    else keys.delete(name)
  }

  beginSteeringButton(id: number, direction: -1 | 1): void {
    this.pointers.set(id, { role: 'button', direction })
    this.steeringKeys.set(`pointer:${id}`, direction)
  }

  setSteeringButtonKeyboard(direction: -1 | 1, key: string, pressed: boolean): void {
    const name = `button:${direction}:${key}`
    this.steeringKeys.delete(name)
    if (pressed) this.steeringKeys.set(name, direction)
  }

  beginSteering(id: number, steering: number): void {
    this.pointers.set(id, { role: 'steering', steering: clamp(steering, -1, 1) })
    if (this.activeSteeringPointer === undefined) {
      this.activeSteeringPointer = id
    }
  }

  updateSteering(id: number, steering: number): void {
    const pointer = this.pointers.get(id)
    if (pointer?.role === 'steering') pointer.steering = clamp(steering, -1, 1)
  }

  beginBrake(id: number): void {
    this.pointers.set(id, { role: 'brake' })
  }

  beginThrottle(id: number): void {
    this.pointers.set(id, { role: 'throttle' })
  }

  endPointer(id: number): void {
    this.pointers.delete(id)
    this.steeringKeys.delete(`pointer:${id}`)
    if (this.activeSteeringPointer === id) {
      this.activeSteeringPointer = [...this.pointers.entries()]
        .find(([, pointer]) => pointer.role === 'steering')?.[0]
    }
  }

  onReset(listener: () => void): () => void {
    this.resetListeners.add(listener)
    return () => {
      this.resetListeners.delete(listener)
    }
  }

  reset(): void {
    this.pointers.clear()
    this.activeSteeringPointer = undefined
    this.steeringKeys.clear()
    this.brakeKeys.clear()
    this.throttleKeys.clear()
    for (const listener of this.resetListeners) listener()
  }
}
