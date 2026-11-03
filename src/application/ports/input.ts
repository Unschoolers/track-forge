import type { DriverInput } from '@/domain/race/raceState'

export interface RaceControlsPort {
  snapshot(): DriverInput
  setKeyboard(key: string, pressed: boolean): void
  beginSteering(pointerId: number, normalizedSteering: number): void
  updateSteering(pointerId: number, normalizedSteering: number): void
  beginBrake(pointerId: number): void
  endPointer(pointerId: number): void
  reset(): void
}
