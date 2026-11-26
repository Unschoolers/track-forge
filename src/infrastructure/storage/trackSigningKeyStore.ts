import { createTrackSigningKey } from '@/application/library/trackSignature'

const DATABASE = 'trackforge-track-signing'
const STORE = 'keys'
const AUTHOR_KEY = 'author'
let signingKey: Promise<CryptoKeyPair> | undefined

function openKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error ?? new Error('Could not open track signing storage.'))
    request.onsuccess = () => resolve(request.result)
  })
}

function readOrStoreKey(database: IDBDatabase, candidate: CryptoKeyPair): Promise<CryptoKeyPair> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    const request: IDBRequest<CryptoKeyPair | undefined> = store.get(AUTHOR_KEY)
    let selected = candidate
    request.onsuccess = () => {
      if (request.result) selected = request.result
      else store.add(candidate, AUTHOR_KEY)
    }
    transaction.oncomplete = () => resolve(selected)
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not save the track signing key.'))
  })
}

async function loadKey(): Promise<CryptoKeyPair> {
  const candidate = await createTrackSigningKey()
  const database = await openKeyStore()
  try {
    // A readwrite transaction lets concurrent windows agree on one author key.
    return await readOrStoreKey(database, candidate)
  } finally {
    database.close()
  }
}

export function getTrackSigningKeys(): Promise<CryptoKeyPair> {
  signingKey ??= loadKey().catch((error: unknown) => {
    signingKey = undefined
    throw error
  })
  return signingKey
}
