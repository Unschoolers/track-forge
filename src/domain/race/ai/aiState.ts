export type AiPersonality = 'cautious' | 'steady' | 'opportunist'

export type AiPhase = 'follow' | 'passing' | 'rejoin'

export interface AiDriverState {
  readonly personality?: AiPersonality
  readonly passTargetId?: string | null
  readonly passElapsed?: number
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

export function createAiDriverState(baseLane: number, personality?: AiPersonality): AiDriverState {
  return {
    ...(personality ? { personality } : {}),
    phase: 'follow',
    passTargetId: null,
    passElapsed: 0,
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
