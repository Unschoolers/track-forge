export function requiresNative(paths: string[]): boolean
export function nativeRequired(
  eventName: string,
  baseSha: string,
  diff?: (command: string, args: string[], options: { encoding: 'utf8'; maxBuffer: number }) => string,
): boolean

export function requiresRelease(paths: string[]): boolean
export function onlyNonProductChanges(comparison: unknown): boolean
export function buildPolicy(
  eventName: string,
  baseSha: string,
  diff?: (command: string, args: string[], options: { encoding: 'utf8'; maxBuffer: number }) => string,
): { native: boolean; release: boolean }
