export type Unsubscribe = () => void

export class EventBus<T> {
  private readonly listeners = new Set<(event: T) => void>()

  subscribe(listener: (event: T) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(event: T): void {
    for (const listener of this.listeners) listener(event)
  }

  clear(): void {
    this.listeners.clear()
  }
}
