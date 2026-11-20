export function requiresNative(paths: string[]): boolean
export function nativeRequired(
  eventName: string,
  baseSha: string,
  diff?: (command: string, args: string[], options: { encoding: 'utf8'; maxBuffer: number }) => string,
): boolean
