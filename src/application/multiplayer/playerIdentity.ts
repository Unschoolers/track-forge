/** Compact, validated multiplayer cosmetic. Never sent in high-frequency pose packets. */
export const TOPPER_ICONS = {
  star: '★',
  flag: '⚑',
  bolt: '⚡',
  crown: '♛',
  diamond: '◆',
  ball: '●',
} as const

export const TOPPER_COLORS = {
  cyan: 0x45deff,
  pink: 0xff679f,
  orange: 0xff9a46,
  lime: 0x9df45b,
  violet: 0xb89aff,
  gold: 0xffdb55,
} as const

export type TopperIcon = keyof typeof TOPPER_ICONS
export type TopperColor = keyof typeof TOPPER_COLORS

export interface PlayerIdentity {
  readonly icon: TopperIcon
  readonly color: TopperColor
}

export const DEFAULT_PLAYER_IDENTITY: PlayerIdentity = { icon: 'star', color: 'cyan' }

/** Assign independent cosmetic attributes once for a new installation. */
export function randomPlayerIdentity(random: () => number = Math.random): PlayerIdentity {
  const icons = Object.keys(TOPPER_ICONS) as TopperIcon[]
  const colors = Object.keys(TOPPER_COLORS) as TopperColor[]
  return {
    icon: icons[Math.floor(random() * icons.length)] ?? DEFAULT_PLAYER_IDENTITY.icon,
    color: colors[Math.floor(random() * colors.length)] ?? DEFAULT_PLAYER_IDENTITY.color,
  }
}

export function normalizePlayerIdentity(value: unknown): PlayerIdentity {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_PLAYER_IDENTITY }
  const candidate = value as Record<string, unknown>
  const icon = candidate.icon
  const color = candidate.color
  return {
    icon: typeof icon === 'string' && Object.hasOwn(TOPPER_ICONS, icon)
      ? icon as TopperIcon : DEFAULT_PLAYER_IDENTITY.icon,
    color: typeof color === 'string' && Object.hasOwn(TOPPER_COLORS, color)
      ? color as TopperColor : DEFAULT_PLAYER_IDENTITY.color,
  }
}

export function isPlayerIdentity(value: unknown): value is PlayerIdentity {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.icon === 'string' && Object.hasOwn(TOPPER_ICONS, candidate.icon) &&
    typeof candidate.color === 'string' && Object.hasOwn(TOPPER_COLORS, candidate.color)
}
