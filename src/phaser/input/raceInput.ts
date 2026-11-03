import { clamp } from '@/domain/geometry/math'
import type { DriverInput } from '@/domain/race/raceState'
import type { RaceControlsPort } from '@/application/ports/input'

type PointerRole = 'steering' | 'brake'

export class RaceInputController implements RaceControlsPort {
  private readonly pointers = new Map<number, PointerRole>()
  private keyboardSteering = 0
  private pointerSteering = 0
  private keyboardBrake = false
  private activeSteeringPointer: number | undefined

  snapshot(): DriverInput {
    return {
      steering:
        this.pointerSteering !== 0
          ? this.pointerSteering
          : this.keyboardSteering,
      throttle: 1,
      braking:
        this.keyboardBrake ||
        [...this.pointers.values()].some((role) => role === 'brake') ||
        this.pointers.size >= 2,
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
    this.pointers.set(id, 'steering')
    if (this.activeSteeringPointer === undefined) {
      this.activeSteeringPointer = id
      this.pointerSteering = clamp(steering, -1, 1)
    }
  }

  updateSteering(id: number, steering: number): void {
    if (id !== this.activeSteeringPointer) return
    this.pointerSteering = clamp(steering, -1, 1)
  }

  beginBrake(id: number): void {
    this.pointers.set(id, 'brake')
  }

  endPointer(id: number): void {
    const role = this.pointers.get(id)
    this.pointers.delete(id)
    if (role === 'steering' && this.activeSteeringPointer === id) {
      this.activeSteeringPointer = undefined
      this.pointerSteering = 0
    }
  }

  reset(): void {
    this.pointers.clear()
    this.activeSteeringPointer = undefined
    this.pointerSteering = 0
    this.keyboardSteering = 0
    this.keyboardBrake = false
  }
}
