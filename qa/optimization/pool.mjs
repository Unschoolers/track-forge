import { Worker } from 'node:worker_threads'

/**
 * Bounded worker pool: one compiled Vite SSR simulator per worker.
 * Reuses track geometry, preserves fixed-step physics, and propagates every
 * simulation exception. Individual jobs never mutate shared production state.
 */
export class SimulationPool {
  constructor({ workers, scenarios, physicsRevision }) {
    if (!Number.isInteger(workers) || workers < 1 || workers > 8)
      throw new Error('Workers must be between 1 and 8')
    this.size = workers
    this.data = { scenarios, physicsRevision }
    this.entries = []
    this.queue = []
    this.running = new Map()
    this.nextId = 1
    this.fatalError = null
    this.baselineProfiles = null
    this.closing = false
  }

  async start() {
    const ready = []
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
        workerData: this.data,
      })
      const entry = { worker, busy: false }
      this.entries.push(entry)
      ready.push(new Promise((resolve, reject) => {
        let initialized = false
        const onMessage = message => {
          if (message.type === 'ready') {
            initialized = true
            resolve()
            this.pump()
          } else if (message.type === 'fatal') {
            const error = new Error(message.error)
            this.fail(error)
            reject(error)
          } else if (message.type === 'result' || message.type === 'error') {
            const request = this.running.get(message.id)
            if (!request) return
            this.running.delete(message.id)
            entry.busy = false
            if (message.type === 'error') {
              const error = new Error(message.error)
              this.fail(error)
              request.reject(error)
            } else {
              request.resolve(message.result)
              this.pump()
            }
          }
        }
        worker.on('message', onMessage)
        worker.on('error', error => { this.fail(error); reject(error) })
        worker.on('exit', code => {
          if (!this.closing && (code !== 0 || !initialized)) {
            const error = new Error(`Simulation worker exited with code ${code}`)
            this.fail(error)
            reject(error)
          }
        })
      }))
    }
    try {
      await Promise.all(ready)
    } catch (error) {
      await this.close()
      throw error
    }
  }

  submit(task) {
    if (this.fatalError) return Promise.reject(this.fatalError)
    if (this.closing) return Promise.reject(new Error('Simulation pool closed'))
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject })
      this.pump()
    })
  }

  pump() {
    if (this.fatalError || this.closing) return
    for (const entry of this.entries) {
      if (entry.busy || this.queue.length === 0) continue
      const request = this.queue.shift()
      const id = this.nextId++
      entry.busy = true
      this.running.set(id, request)
      entry.worker.postMessage({ type: 'trial', id, task: request.task })
    }
  }

  fail(error) {
    if (this.fatalError) return
    this.fatalError = error
    for (const item of this.queue.splice(0)) item.reject(error)
    for (const item of this.running.values()) item.reject(error)
    this.running.clear()
  }

  async close() {
    this.closing = true
    await Promise.all(this.entries.map(x => x.worker.terminate()))
    this.entries = []
  }
}
