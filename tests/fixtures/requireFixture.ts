export function requireFixture<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test fixture')
  return value
}
