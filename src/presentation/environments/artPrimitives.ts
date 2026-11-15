import type { SceneryArtDefinition, SceneryPrimitive } from './types'

export const ellipse = (
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  color: number,
  alpha = 1,
): SceneryPrimitive => ({
  kind: 'ellipse',
  x,
  y,
  radiusX,
  radiusY,
  color,
  alpha,
})
export const polygon = (
  points: readonly [number, number][],
  color: number,
  alpha = 1,
): SceneryPrimitive => ({
  kind: 'polygon',
  points: points.map(([x, y]) => ({ x, y })),
  color,
  alpha,
})
export const art = (
  label: string,
  radius: number,
  shapes: (night: boolean) => readonly SceneryPrimitive[],
): SceneryArtDefinition => ({
  label,
  radius,
  day: shapes(false),
  night: shapes(true),
})
