import { describe, expect, it } from 'vitest'
import { NearbyOperationQueue } from '@/application/multiplayer/nearbyOperationQueue'

describe('NearbyOperationQueue', () => {
  it('orders stop ahead of a new room and suppresses stale completion', async () => {
    const queue = new NearbyOperationQueue()
    const events: string[] = []
    let release: () => void = () => { throw new Error('operation did not start') }
    const pending = new Promise<void>(resolve => { release = resolve })
    const old = queue.invalidate()
    queue.perform(old, () => pending, () => events.push('old start'),
      () => events.push('old done'), () => events.push('old error'))
    await Promise.resolve()
    queue.invalidate()
    queue.stop(async () => { events.push('stop') }, () => events.push('stop error'))
    const current = queue.generation
    const finished = new Promise<void>(resolve => {
      queue.perform(current, async () => { events.push('new action') },
        () => events.push('new start'), () => { events.push('new done'); resolve() },
        () => { events.push('new error'); resolve() })
    })
    release()
    await finished
    expect(events).toEqual(['old start', 'stop', 'new start', 'new action', 'new done'])
  })

  it('reports a current failure and keeps later operations runnable', async () => {
    const queue = new NearbyOperationQueue()
    const error = new Error('native failed')
    const errors: unknown[] = []
    const active = queue.generation
    queue.perform(active, async () => { throw error }, () => {}, () => {}, e => errors.push(e))
    await new Promise<void>(resolve => {
      queue.perform(active, async () => {}, () => {}, () => resolve(), () => resolve())
    })
    expect(errors).toEqual([error])
  })
})
