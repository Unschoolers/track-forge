import type { Vector2 } from '@/domain/model'

const MIN_LAMP_SPACING = 54
const CELL_WIDTH = MIN_LAMP_SPACING

/** Spatial buckets of accepted posts; checks at most nine adjacent cells. */
export class LampSpacingIndex {
  private readonly cells = new Map<string, Vector2[]>()

  tryAdd(position: Vector2): boolean {
    const column = Math.floor(position.x / CELL_WIDTH)
    const row = Math.floor(position.y / CELL_WIDTH)
    for (let y = row - 1; y <= row + 1; y++) {
      for (let x = column - 1; x <= column + 1; x++) {
        const nearby = this.cells.get(`${x}:${y}`)
        if (!nearby) continue
        for (const other of nearby) {
          if (Math.hypot(other.x - position.x, other.y - position.y) < MIN_LAMP_SPACING) {
            return false
          }
        }
      }
    }
    const key = `${column}:${row}`
    const bucket = this.cells.get(key)
    if (bucket) bucket.push(position)
    else this.cells.set(key, [position])
    return true
  }
}
