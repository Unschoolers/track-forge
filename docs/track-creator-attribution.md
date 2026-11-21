# Track creator attribution

Track Forge remains local-first. The display name is an editable profile label,
not an authenticated account. Each installation gets a stable creator ID.

## Permanent contracts

- System creator: `{ id: 'trackforge-system', name: 'Track Forge' }`.
- Built-in starter track: stable ID `system-starter-circuit` on every installation.
- Official circuits retain their stable `official-*` IDs.
- Built-in tracks have `origin: 'seeded'` and cannot be shared; editing them
  forks a new personal copy.
- Player tracks use `origin: 'local'` and their installation-scoped creator ID.
- Imported tracks retain their credited author and use `origin: 'imported'`.
- Editable names change the credits on matching player tracks only. No geometry,
  timestamps or race revisions change, preserving score/ghost identity.
- Import/export format versions stay compatible with older files.

## Temporary release migration — intentionally removable

**All one-time conversion code lives in**
`src/migrations/migration_track_creator_v1.ts`.
`src/main.ts` has one startup import and one invocation. The one-time marker
`trackforge-creator-migration-v1` is defined **inside that module only**.

On the first load of the upgraded release, the migration:
1. Assigns a stable local creator ID before asking for a display name.
2. Identifies original, unchanged legacy starter tracks by their geometry,
   preserving their existing IDs and crediting them to Track Forge.
3. Assigns every other uncredited saved track to the local player, including
   old imports predating attribution.
4. Writes the library as a single batch and marks migration complete only if
   it succeeds. Failed writes leave the marker unset so startup retries.
5. Never runs again after the marker has been written. The subsequent name
   selection updates the provisional credit of that same ID.

**Removal after the migration window:** delete the migration module, its
dedicated tests, and the one import plus call in `main.ts`. No permanent model,
ownership policy, or storage key relies on migration code. Old installed clients
that skipped the migration window would require a separate compatibility plan.

Creator IDs in track files are attribution, not authenticated ownership.
