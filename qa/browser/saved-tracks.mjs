/** Read committed records, never the application draft cache. */
export function readSavedTracks(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('trackforge-track-library', 1)
    open.onupgradeneeded = () => {
      open.transaction.abort()
      reject(new Error('Track library was not initialized by the application'))
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('tracks', 'readonly')
      const request = tx.objectStore('tracks').getAll()
      tx.oncomplete = () => { db.close(); resolve(request.result) }
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Track read aborted')) }
    }
  }))
}
