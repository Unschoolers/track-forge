export type AiPhase = 'follow' | 'passing' | 'rejoin'

export interface AiDriverState {
  readonly phase: AiPhase
  readonly baseLane: number
  readonly targetLane: number
  readonly passLane: number
  readonly holdRemaining: number
  readonly cooldownRemaining: number
  readonly clearTime: number
  readonly steer: number
  readonly mistakeOffset: number
  readonly mistakeRemaining: number
}

export function createAiDriverState(baseLane: number): AiDriverState {
  return {
    phase: 'follow',
    baseLane,
    targetLane: baseLane,
    passLane: baseLane,
    holdRemaining: 0,
    cooldownRemaining: 0,
    clearTime: 0,
    steer: 0,
    mistakeOffset: 0,
    mistakeRemaining: 0,
  }
}
