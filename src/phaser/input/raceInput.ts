import { clamp } from '@/domain/geometry/math'
import type { DriverInput } from '@/domain/race/raceState'
import type { RaceControlsPort } from '@/application/ports/input'

type PointerState =
  | { readonly role: 'steering'; steering: number }
  | { readonly role: 'brake' }

export class RaceInputController implements RaceControlsPort {
  private readonly pointers = new Map<number, PointerState>()
  private keyboardSteering = 0
  private keyboardBrake = false
  private activeSteeringPointer: number | undefined
  private readonly resetListeners = new Set<() => void>()

  snapshot(): DriverInput {
    const activePointer = this.activeSteeringPointer === undefined
      ? undefined
      : this.pointers.get(this.activeSteeringPointer)
    return {
      steering: activePointer?.role === 'steering'
        ? activePointer.steering
        : this.keyboardSteering,
      throttle: 1,
      braking:
        this.keyboardBrake ||
        [...this.pointers.values()].some((pointer) => pointer.role === 'brake'),
    }
  }

  setKeyboard(key: string, pressed: boolean): void {
    if (
      key === 'ArrowLeft' ||
      key.toLowerCase() === 'a'
    ) {
      this.keyboardSteering = pressed ? -1 : 0
    }
    if (key === 'ArrowRight' || key.toLowerCase() === 'd') {
      this.keyboardSteering = pressed ? 1 : 0
    }
    if (
      key === ' ' ||
      key === 'ArrowDown' ||
      key.toLowerCase() === 's'
    ) {
      this.keyboardBrake = pressed
    }
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

  endPointer(id: number): void {
    this.pointers.delete(id)
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
    this.keyboardSteering = 0
    this.keyboardBrake = false
    for (const listener of this.resetListeners) listener()
  }
}
