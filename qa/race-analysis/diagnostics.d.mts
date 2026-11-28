export interface DiagnosticSample {
  time: number
  speed?: number | null
  angle?: number | null
  yawRate?: number | null
  slip?: number | null
  steering?: number | null
  pathIndex?: number | null
  cut?: boolean
}
export interface DiagnosticEvent {
  time: number
  type: string
  reason?: string
  pathIndex?: number
  before?: DiagnosticSample
}
export interface DiagnosticGate { lap: number; gate: number; time: number }
export function diagnoseTimeline(input: {
  samples: DiagnosticSample[]; events: DiagnosticEvent[]; gates: DiagnosticGate[]
}, level?: number): Record<string, unknown>
