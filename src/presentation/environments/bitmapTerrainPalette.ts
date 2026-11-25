import type { ElevationShading } from './elevationMaterials'

/** Visual-only terrain tint profile. All color choices are independent of
 * terrain kind, friction, height and collision. New themes supply data here
 * rather than branching in the tile painter. */
export interface BitmapTerrainPalette {
  readonly outerBank: string
  readonly wetBank: string
  readonly deepGlaze: string
  readonly shallow: readonly [string, string, string]
  readonly contact: string
  readonly waterDetail?: 'oil-slicks'
  /** Width multipliers, in (0, 1]; smaller spills need narrower rims. */
  readonly bankScale?: number
  readonly shallowScale?: number
}

interface BitmapTerrainProfile extends BitmapTerrainPalette {
  readonly raised: ElevationShading
}

type LightingProfiles = Readonly<Record<'day' | 'night', BitmapTerrainProfile>>

export const MEADOW_TERRAIN_ART = {
  day: {
    outerBank: '#9a9860', wetBank: '#c7b47f', deepGlaze: 'rgba(4,46,76,0.66)',
    shallow: ['#35a7b0', '#66c9bb', '#9bd9b9'], contact: '#e6f5d8',
    raised: {
      slopeShadow: '10,26,20', slopeLight: '246,224,173',
      slopeShadowStrength: 0.135, slopeLightStrength: 0.095,
      plateauGlaze: 'rgba(14,43,29,0.34)',
    },
  },
  night: {
    outerBank: '#586045', wetBank: '#676954', deepGlaze: 'rgba(5,20,38,0.72)',
    shallow: ['#286371', '#398184', '#69988d'], contact: '#b2d1c8',
    raised: {
      slopeShadow: '10,26,20', slopeLight: '246,224,173',
      slopeShadowStrength: 0.135, slopeLightStrength: 0.095,
      plateauGlaze: 'rgba(5,19,15,0.28)',
    },
  },
} as const satisfies LightingProfiles

export const DESERT_TERRAIN_ART = {
  day: {
    outerBank: '#b98649', wetBank: '#e6c187', deepGlaze: 'rgba(0,54,74,0.49)',
    shallow: ['#22b7b0', '#71d7c5', '#c1e7bb'], contact: '#fff2d6',
    raised: {
      slopeShadow: '117,65,34', slopeLight: '255,229,170',
      slopeShadowStrength: 0.08, slopeLightStrength: 0.085,
      plateauGlaze: 'rgba(255,211,133,0.23)',
    },
  },
  night: {
    outerBank: '#665349', wetBank: '#8f7961', deepGlaze: 'rgba(4,19,39,0.60)',
    shallow: ['#28687c', '#408f97', '#78b0a5'], contact: '#c9d4b9',
    raised: {
      slopeShadow: '24,21,32', slopeLight: '172,155,134',
      slopeShadowStrength: 0.08, slopeLightStrength: 0.055,
      plateauGlaze: 'rgba(144,125,103,0.15)',
    },
  },
} as const satisfies LightingProfiles


export const CITY_TERRAIN_ART = {
  day: {
    outerBank: '#737c77', wetBank: '#999d94', deepGlaze: 'rgba(9,32,48,0.42)',
    shallow: ['#377786', '#518b93', '#82a5a0'], contact: '#c4d1cc',
    raised: {
      slopeShadow: '27,36,42', slopeLight: '224,220,196',
      slopeShadowStrength: 0.10, slopeLightStrength: 0.06,
      plateauGlaze: 'rgba(203,205,192,0.12)',
    },
    waterDetail: 'oil-slicks',
  },
  night: {
    outerBank: '#39454b', wetBank: '#55676b', deepGlaze: 'rgba(3,15,30,0.48)',
    shallow: ['#255363', '#376977', '#527d85'], contact: '#96afb0',
    raised: {
      slopeShadow: '9,16,27', slopeLight: '156,180,185',
      slopeShadowStrength: 0.085, slopeLightStrength: 0.055,
      plateauGlaze: 'rgba(112,137,145,0.12)',
    },
    waterDetail: 'oil-slicks',
  },
} as const satisfies LightingProfiles


export const KIDS_ROOM_TERRAIN_ART = {
  day: {
    outerBank: '#524173', wetBank: '#873d62', deepGlaze: 'rgba(103,22,66,0.36)',
    shallow: ['#c96987', '#df889e', '#efb1bd'], contact: '#ffdfdb',
    raised: {
      slopeShadow: '67,25,48', slopeLight: '255,232,210',
      slopeShadowStrength: 0.115, slopeLightStrength: 0.075,
      plateauGlaze: 'rgba(135,49,62,0.12)',
    },
    bankScale: 0.55, shallowScale: 0.42,
  },
  night: {
    outerBank: '#332847', wetBank: '#563047', deepGlaze: 'rgba(44,12,40,0.42)',
    shallow: ['#8a456f', '#ae6a8e', '#d090a5'], contact: '#eac1c8',
    raised: {
      slopeShadow: '24,14,35', slopeLight: '184,156,176',
      slopeShadowStrength: 0.10, slopeLightStrength: 0.055,
      plateauGlaze: 'rgba(77,37,68,0.12)',
    },
    bankScale: 0.55, shallowScale: 0.42,
  },
} as const satisfies LightingProfiles
