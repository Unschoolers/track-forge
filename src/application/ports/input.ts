import type { DriverInput } from '@/domain/race/raceState'

export interface RaceControlsPort {
  snapshot(): DriverInput
  setKeyboard(key: string, pressed: boolean): void
  setPedalKeyboard(pedal: 'brake' | 'throttle', key: string, pressed: boolean): void
  /** Queue one activation edge for the next simulation input sample. */
  consumeBoostRequest(): boolean
  beginSteeringButton(pointerId: number, direction: -1 | 1): void
  setSteeringButtonKeyboard(direction: -1 | 1, key: string, pressed: boolean): void
  beginSteering(pointerId: number, normalizedSteering: number): void
  updateSteering(pointerId: number, normalizedSteering: number): void
  beginBrake(pointerId: number): void
  beginThrottle(pointerId: number): void
  beginBoost(pointerId: number): void
  setBoostKeyboard(key: string, pressed: boolean): void
  endPointer(pointerId: number): void
  /** Release any captured pointers when the shared input is reset. */
  onReset(listener: () => void): () => void
  reset(): void
}
