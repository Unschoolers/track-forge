type Outcome = void | 'skipped' | 'failed'

/** Serialize native connection operations and invalidate stale room callbacks.
 * Stop is deliberately unconditional and ordered ahead of the next room.
 */
export class NearbyOperationQueue {
  private epoch = 0
  private busy: Promise<void> = Promise.resolve()

  get generation(): number { return this.epoch }

  invalidate(): number { return ++this.epoch }

  perform(
    active: number,
    action: () => Promise<Outcome>,
    started: () => void,
    completed: (outcome: Outcome) => void,
    failed: (error: unknown) => void,
  ): void {
    this.busy = this.busy.then(async () => {
      if (active !== this.epoch) return
      started()
      const outcome = await action()
      if (active === this.epoch) completed(outcome)
    }).catch((error: unknown) => {
      if (active === this.epoch) failed(error)
    })
  }

  stop(action: () => Promise<void>, failed: (error: unknown) => void): void {
    this.busy = this.busy.then(action).catch(failed)
  }
}
