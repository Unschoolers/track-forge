import type Phaser from 'phaser'
import type { Vector2 } from '@/domain/model'

interface ToyCurb {
  readonly start: Vector2
  readonly end: Vector2
  readonly width: number
  readonly color: 'red' | 'white'
}

/** One molded plastic brick per existing apex segment, inside its footprint. */
export function renderToyCurb(graphics: Phaser.GameObjects.Graphics, curb: ToyCurb, night: boolean): void {
  const length = Math.hypot(curb.end.x - curb.start.x, curb.end.y - curb.start.y)
  if (length <= 0 || curb.width <= 0) return
  const gap = Math.min(0.6, length * 0.08)
  const half = length / 2 - gap
  const width = curb.width
  const radius = Math.min(width * 0.23, half * 0.4)
  const color = curb.color === 'red' ? (night ? 0x9e4248 : 0xe84a43) : (night ? 0xb18b40 : 0xf5bf35)
  graphics.save()
  graphics.translateCanvas((curb.start.x + curb.end.x) / 2, (curb.start.y + curb.end.y) / 2)
  graphics.rotateCanvas(Math.atan2(curb.end.y - curb.start.y, curb.end.x - curb.start.x))
  graphics.fillStyle(0x30252a, 0.8)
  graphics.fillRoundedRect(-half, -width / 2, half * 2, width, radius)
  const inset = Math.min(0.65, width * 0.10, half * 0.15)
  graphics.fillStyle(color, 1)
  graphics.fillRoundedRect(-half + inset, -width / 2 + inset, (half - inset) * 2, width - inset * 2, radius)
  const count = Math.max(1, Math.floor((half * 2) / (width * 0.85)))
  const stud = Math.min(width * 0.21, half / count * 0.58)
  for (let i = 0; i < count; i++) {
    const x = -half + (i + 0.5) * half * 2 / count
    graphics.fillStyle(0x38282a, 0.35)
    graphics.fillCircle(x, stud * 0.24, stud * 1.12)
    graphics.fillStyle(color, 1)
    graphics.fillCircle(x, 0, stud)
    graphics.fillStyle(0xffffff, night ? 0.22 : 0.48)
    graphics.fillCircle(x - stud * 0.30, -stud * 0.30, stud * 0.30)
  }
  graphics.restore()
}
