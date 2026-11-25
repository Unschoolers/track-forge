# Track library storage

## Incident and contract

Android 2.0.1806.1 received the large Nearby track and reached share review, then saving failed. The diagnostic export had no persistence failure. The old repository rewrote a single uncompressed localStorage library on every save; quota exhaustion is plausible but not confirmed.

The IndexedDB repository stores one canonical record per track ID and uses a synchronous hydrated read cache. Saves, deletes and attribution batches are asynchronous in production; the cache and successful UI transition happen only after the transaction completes. The existing synchronous repository remains a migration reader and test adapter. No transfer protocol or track codec changes. Scores, ghosts, IDs, revisions and preferences keep their existing formats.

## Migration and rollback

Version 1 of `trackforge-track-library` creates `tracks` and `legacyBackup` in one atomic upgrade transaction. Read the same v1/v2 library and recoverable autosave sources without quota-limited writes, normalize with the existing codec, and retain exact source strings in the backup store. Only after opening and reading the committed database remove unchanged source keys; an interrupted cleanup can retry at startup. Subsequent launches do not reimport old tracks. Failed opens surface through startup error handling, not a stale or empty fallback library. Do not downgrade to the old binary without exporting the current tracks: old binaries cannot read IndexedDB. Keep the backup store for recovery.

## Verification

Check large imported libraries beyond 5 MiB, migration and reload, transaction aborts, IDs/revisions, and retry without false success. Verify explicit-save and cancel behavior, share acknowledgement timing and production startup. The original Android quota error is still unconfirmed.
