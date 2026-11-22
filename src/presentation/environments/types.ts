/** Colors used to present an environment in the editor, race, and flyover. */
export interface EnvironmentPalette {
  readonly editorGround: string
  readonly raceGround: string
  readonly flyoverGround: string
  readonly hillSlope: number
  readonly hillPlateau: number
  readonly flyoverHill: string
  readonly shorelineLand: number
  /** Optional themed water/juice colors, separate from water physics. */
  readonly waterFill?: number
  readonly waterRipple?: number
  readonly waterShoreline?: number
  readonly flyoverWater?: string
}

import type { Vector2 } from '@/domain/model'
import type { SceneryPropKind } from '@/domain/track/trackEnvironment'

export type SceneryPrimitive =
  | { readonly kind: 'ellipse'; readonly x: number; readonly y: number; readonly radiusX: number; readonly radiusY: number; readonly color: number; readonly alpha?: number }
  | { readonly kind: 'polygon'; readonly points: readonly Vector2[]; readonly color: number; readonly alpha?: number }

export interface SceneryArtDefinition {
  readonly label: string
  readonly radius: number
  readonly day: readonly SceneryPrimitive[]
  readonly night: readonly SceneryPrimitive[]
}

export interface TrackEnvironmentDefinition {
  readonly label: string
  readonly day: EnvironmentPalette
  readonly night: EnvironmentPalette
  readonly scenery: Readonly<Partial<Record<SceneryPropKind, SceneryArtDefinition>>>
  readonly groundArt: (variant: number, night: boolean) => readonly SceneryPrimitive[]
}
