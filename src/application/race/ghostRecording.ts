import type { RaceVehicle } from '@/domain/race/raceState'
import { captureGhost, MAX_GHOST_FRAMES, type GhostFrame } from './ghostReplay'

/** Bounded replay recording, with explicit cuts for Arcade recoveries. */
export class GhostRecording {
  private frames: GhostFrame[]
  private valid = true
  private interval = 0.1

  constructor(player: RaceVehicle, private readonly arcade: boolean) {
    this.frames = [captureGhost(player, 0)]
  }

  recover(before: RaceVehicle, after: RaceVehicle, time: number): void {
    if (!this.arcade) { this.valid = false; return }
    const last = this.frames.at(-1)
    if (last?.t === time && last.cut) {
      // Multiple resets within one physics tick share the original approach.
      this.frames[this.frames.length - 1] = { ...captureGhost(after, time), cut: true }
      return
    }
    const preTime = Math.max(0, time - 0.000001)
    while (this.frames.length > 1 && (this.frames.at(-1)?.t ?? 0) >= preTime) this.frames.pop()
    this.append(captureGhost(before, preTime))
    this.append({ ...captureGhost(after, time), cut: true })
  }

  sample(player: RaceVehicle, time: number, finished = false): void {
    if (!this.valid) return
    if (player.wrecked && !this.arcade) { this.valid = false; return }
    const last = this.frames.at(-1)
    if (!finished && last && time < last.t + this.interval) return
    const jumped = last !== undefined && Math.hypot(player.x - last.x, player.y - last.y) >
      Math.max(85, player.speed * Math.max(0.25, (time - last.t) * 2) + 25)
    if (jumped && !this.arcade) { this.valid = false; return }
    this.append({ ...captureGhost(player, time), ...(jumped ? { cut: true } : {}) })
  }

  finish(player: RaceVehicle, time: number): readonly GhostFrame[] | null {
    this.sample(player, time, true)
    return this.valid ? this.frames : null
  }

  private append(frame: GhostFrame): void {
    const last = this.frames.at(-1)
    if (last?.t === frame.t) {
      this.frames[this.frames.length - 1] = { ...frame, ...(last.cut ? { cut: true } : {}) }
      return
    }
    if (this.frames.length >= MAX_GHOST_FRAMES) {
      if (!this.arcade) { this.valid = false; return }
      const compact: GhostFrame[] = this.frames[0] ? [this.frames[0]] : []
      for (let index = 1; index < this.frames.length; index += 2) {
        const left = this.frames[index]
        const right = this.frames[index + 1] ?? left
        // Prefer a cut's own timestamp instead of moving it onto a later pose.
        // With adjacent cuts retain the later cut, which still prevents a lerp.
        const kept = right?.cut ? right : left?.cut ? left : right
        if (kept) compact.push(kept)
      }
      this.frames = compact
      this.interval *= 2
    }
    this.frames.push(frame)
  }
}
