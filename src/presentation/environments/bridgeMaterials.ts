import type { Vector2 } from '@/domain/model'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { BridgePrimitive } from '@/phaser/rendering/bridgeRenderer'
import { roadColorsForEnvironment } from './roadMaterials'
import { environmentRoadStrokes } from './environmentRoadStrokes'

interface BridgePalette {
  readonly edge: number
  readonly face: number
  readonly support: number
  readonly rail: number
  readonly highlight: number
  readonly seam: number
  readonly hardware: number
}

interface BridgeTheme {
  readonly day: BridgePalette
  readonly night: BridgePalette
  readonly jointSpacing: number
  readonly railSpacing: number
  readonly jointWidth: number
  readonly railWidth: number
}

/** Visual kits only: the existing authored road surface is never replaced. */
export const BRIDGE_THEMES = {
  grass: {
    day: { edge: 0x9b8c6b, face: 0x5e624c, support: 0x777b69, rail: 0x855b39, highlight: 0xd0a16a, seam: 0x493d30, hardware: 0x49372b },
    night: { edge: 0x515446, face: 0x303c34, support: 0x444f43, rail: 0x674c37, highlight: 0x9e825e, seam: 0x272c27, hardware: 0x302d27 },
    jointSpacing: 96, railSpacing: 24, jointWidth: 1.4, railWidth: 7,
  },
  desert: {
    day: { edge: 0xd1b07c, face: 0x9c6948, support: 0xb38a5e, rail: 0xcba16d, highlight: 0xf4d3a1, seam: 0x856443, hardware: 0x99744b },
    night: { edge: 0x75624e, face: 0x52453b, support: 0x6c5848, rail: 0x927758, highlight: 0xbba17d, seam: 0x403730, hardware: 0x665440 },
    jointSpacing: 80, railSpacing: 18, jointWidth: 1.5, railWidth: 7,
  },
  cityscape: {
    day: { edge: 0x839298, face: 0x46535b, support: 0x828a88, rail: 0x415b6b, highlight: 0xc7d4d5, seam: 0x252e34, hardware: 0xa68160 },
    night: { edge: 0x485963, face: 0x222f39, support: 0x46565c, rail: 0x344e60, highlight: 0x91a6b0, seam: 0x17242f, hardware: 0x765b46 },
    jointSpacing: 120, railSpacing: 30, jointWidth: 2.2, railWidth: 6,
  },
  'kids-room': {
    day: { edge: 0xc8a46e, face: 0x9b614b, support: 0xb56e48, rail: 0xb94e48, highlight: 0xf6cd74, seam: 0x455975, hardware: 0x3d82af },
    night: { edge: 0x73604e, face: 0x593d43, support: 0x744d40, rail: 0x874b52, highlight: 0xc6a66d, seam: 0x28394f, hardware: 0x376487 },
    jointSpacing: 72, railSpacing: 24, jointWidth: 1.5, railWidth: 7,
  },
} as const satisfies Record<TrackEnvironmentId, BridgeTheme>

export type BridgePaintCommand =
  | { readonly kind: 'fill'; readonly polygon: readonly [Vector2, Vector2, Vector2, Vector2]; readonly color: number; readonly alpha: number }
  | { readonly kind: 'line'; readonly start: Vector2; readonly end: Vector2; readonly width: number; readonly color: number; readonly alpha: number }

function hex(value: string): number { return Number.parseInt(value.slice(1), 16) }

function lerp(a: Vector2, b: Vector2, t: number): Vector2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Distance-anchored joints survive resampling, curves and the loop seam. */
export function bridgeJointFractions(from: number, to: number, spacing: number): readonly number[] {
  if (![from, to, spacing].every(Number.isFinite) || to <= from || spacing <= 0) return []
  const first = Math.floor(from / spacing) + 1
  const last = Math.min(Math.floor(to / spacing), first + 31)
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => ((first + i) * spacing - from) / (to - from))
}

/** Shared visual commands for Phaser graphics, bitmap overlays and flyover.
 * Bitmap surfaces retain the exact road texture; their base fill and vector
 * road-detail fallback are omitted, while the themed joints stay identical. */
export function bridgePaintCommands(
  primitive: BridgePrimitive, environment: TrackEnvironmentId, night: boolean,
  bitmapSurface = false, loopLength?: number,
): readonly BridgePaintCommand[] {
  const theme = BRIDGE_THEMES[environment]
  const palette = night ? theme.night : theme.day
  const spec = roadColorsForEnvironment(primitive.surface, environment)
  const commands: BridgePaintCommand[] = []
  const line = (start: Vector2, end: Vector2, width: number, color: number, alpha = 1) => {
    commands.push({ kind: 'line', start, end, width, color, alpha })
  }
  if ('polygon' in primitive) {
    const fill = (color: number, alpha = 1) => commands.push({ kind: 'fill', polygon: primitive.polygon, color, alpha })
    const [faceA, faceB, faceC, faceD] = primitive.polygon
    const faceBand = (start: number, end: number, color: number, alpha: number) => {
      commands.push({ kind: 'fill', polygon: [lerp(faceA, faceD, start), lerp(faceB, faceC, start), lerp(faceB, faceC, end), lerp(faceA, faceD, end)], color, alpha })
    }
    switch (primitive.kind) {
      case 'shadow-soft': if (!night) fill(0x050807, 0.15); break
      case 'shadow-core': if (!night) fill(0x050807, 0.29); break
      case 'side-face':
        fill(palette.face, night ? 0.94 : 0.90)
        // Light catches the deck lip; the lower fascia falls into shadow.
        faceBand(0, 0.13, palette.highlight, night ? 0.28 : 0.50)
        faceBand(0.13, 0.25, palette.edge, 0.36)
        faceBand(0.64, 1, palette.seam, night ? 0.40 : 0.28)
        faceBand(0.90, 1, palette.seam, 0.38)
        break
      case 'edge': fill(palette.edge); break
      case 'surface': {
        const quad = primitive.roadQuad
        if (!bitmapSurface) {
          fill(hex(night ? spec.nightRoad : spec.road))
          if (quad) {
            for (const detail of environmentRoadStrokes(environment, quad.surface, quad.from, quad.to, night, loopLength)) {
              line(detail.start, detail.end, detail.width, detail.color, detail.alpha)
            }
          }
        }
        if (!quad) break
        const [a, b, c, d] = quad.road
        // Contact shadow under both rails gives the road a recessed deck.
        // Stay within the surface so the underlying texture remains visible.
        if (!primitive.rampApproach) {
          for (const t of [0.055, 0.945]) {
            const start = lerp(a, d, t), end = lerp(b, c, t)
            line(start, end, 3.5, palette.seam, 0.26)
            line(start, end, 1.2, palette.seam, 0.22)
          }
        }
        // Thin expansion joints / material seams across the road, inset from
        // the existing guardrails. Do not add a new physical road surface.
        for (const t of bridgeJointFractions(quad.from.distance, quad.to.distance, theme.jointSpacing)) {
          const left = lerp(a, b, t), right = lerp(d, c, t)
          line(lerp(left, right, 0.10), lerp(left, right, 0.90), theme.jointWidth, palette.seam, 0.56)
        }
        break
      }
    }
  } else {
    const { start, end } = primitive
    switch (primitive.kind) {
      case 'pillar':
        line(start, end, 11, palette.face, 0.95)
        line(start, end, 6, palette.support, 0.95)
        break
      case 'marking':
        line(start, end, primitive.surface === 'street' ? 2.4 : 1.7, hex(night ? spec.nightStripe : spec.stripe), 0.8)
        break
      case 'wall': {
        line(start, end, theme.railWidth, palette.rail)
        line(start, end, Math.max(1, theme.railWidth - 2), palette.seam, 0.26)
        line(start, end, 1.7, palette.highlight, 0.85)
        const span = primitive.distanceSpan
        const length = Math.hypot(end.x - start.x, end.y - start.y)
        if (!span || length < 0.001) break
        const nx = -(end.y - start.y) / length * (theme.railWidth / 2 - 0.6)
        const ny = (end.x - start.x) / length * (theme.railWidth / 2 - 0.6)
        for (const t of bridgeJointFractions(span[0], span[1], theme.railSpacing)) {
          const p = lerp(start, end, t)
          line({ x: p.x - nx, y: p.y - ny }, { x: p.x + nx, y: p.y + ny }, 2, palette.hardware)
        }
        break
      }
    }
  }
  return commands
}

export function paintBridgeCanvas(context: CanvasRenderingContext2D, commands: readonly BridgePaintCommand[]): void {
  context.save()
  context.lineCap = 'butt'
  for (const command of commands) {
    const color = `#${command.color.toString(16).padStart(6, '0')}`
    context.globalAlpha = command.alpha
    context.beginPath()
    if (command.kind === 'fill') {
      const [a, b, c, d] = command.polygon
      context.moveTo(a.x, a.y); context.lineTo(b.x, b.y)
      context.lineTo(c.x, c.y); context.lineTo(d.x, d.y)
      context.closePath()
      context.fillStyle = color
      context.fill()
    } else {
      context.moveTo(command.start.x, command.start.y)
      context.lineTo(command.end.x, command.end.y)
      context.lineWidth = command.width
      context.strokeStyle = color
      context.stroke()
    }
  }
  context.restore()
}
