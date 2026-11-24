import { describe, expect, it, vi } from 'vitest'
import { NearbyRosterDelivery } from '@/application/multiplayer/nearbyRosterDelivery'

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('NearbyRosterDelivery', () => {
  it('coalesces each slow peer independently and keeps the staging barrier until the latest snapshot succeeds', async () => {
    const queue = new NearbyRosterDelivery()
    const old = deferred()
    const latest = deferred()
    const sent: string[] = []
    const failed = vi.fn()
    const settled = vi.fn()
    const superseded = vi.fn()
    const publish = (revision: number) => queue.publish(['slow', 'fast'], {
      revision, failed, settled, superseded,
      send: async id => {
        sent.push(id + ':' + revision)
        if (id === 'slow' && revision === 1) await old.promise
        if (id === 'slow' && revision === 5) await latest.promise
      },
    })
    publish(1)
    for (let revision = 2; revision <= 5; revision++) {
      publish(revision)
      await Promise.resolve()
    }
    await vi.waitFor(() => expect(sent).toContain('fast:5'))
    expect(sent.filter(x => x.startsWith('slow:'))).toEqual(['slow:1'])
    old.reject(new Error('Old delivery failed'))
    await vi.waitFor(() => expect(sent).toContain('slow:5'))
    expect(sent.filter(x => x.startsWith('slow:'))).toEqual(['slow:1', 'slow:5'])
    expect(superseded).toHaveBeenCalledOnce()
    expect(failed).not.toHaveBeenCalled()
    expect(queue.pending).toBe(true)
    latest.resolve()
    await vi.waitFor(() => expect(queue.pending).toBe(false))
    expect(failed).not.toHaveBeenCalled()
  })

  it('reports a failed replacement rather than silently discarding it', async () => {
    const queue = new NearbyRosterDelivery()
    const old = deferred()
    const failed = vi.fn()
    const settled = vi.fn()
    const superseded = vi.fn()
    queue.publish(['peer'], { revision: 1, send: () => old.promise, failed, settled, superseded })
    const error = new Error('Latest roster failed')
    queue.publish(['peer'], { revision: 2, send: async () => { throw error }, failed, settled, superseded })
    old.reject(new Error('Old roster failed'))
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(error))
    expect(settled).not.toHaveBeenCalled()
    expect(superseded).toHaveBeenCalledOnce()
  })

  it('does not let a removed peer or previous round settle a new queue', async () => {
    const queue = new NearbyRosterDelivery()
    const old = deferred()
    const fresh = deferred()
    const settled = vi.fn()
    const failed = vi.fn()
    const superseded = vi.fn()
    queue.publish(['peer'], { revision: 1, send: () => old.promise, settled, failed, superseded })
    queue.removePeer('peer')
    queue.reset()
    queue.publish(['peer'], { revision: 1, send: () => fresh.promise, settled, failed, superseded })
    old.reject(new Error('Previous round failed'))
    await Promise.resolve()
    await Promise.resolve()
    expect(queue.pending).toBe(true)
    expect(failed).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()
    fresh.resolve()
    await vi.waitFor(() => expect(queue.pending).toBe(false))
    expect(settled).toHaveBeenCalledOnce()
  })
})
