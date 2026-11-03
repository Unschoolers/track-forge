import type { KeyValueStore } from '@/application/ports/storage'

export class BrowserStorage implements KeyValueStore {
  constructor(private readonly storage: Storage = window.localStorage) {}

  get(key: string): string | null {
    try {
      return this.storage.getItem(key)
    } catch {
      return null
    }
  }

  set(key: string, value: string): boolean {
    try {
      this.storage.setItem(key, value)
      return true
    } catch {
      return false
    }
  }

  remove(key: string): boolean {
    try {
      this.storage.removeItem(key)
      return true
    } catch {
      return false
    }
  }
}
