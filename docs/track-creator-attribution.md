# Track creator attribution

Local-first Track Forge currently has **no account authentication**. A player chooses a
display name (2–24 characters) on first launch and can change it in Options → Profile.
The profile uses a stable installation-scoped creator ID, not a remote username. No
global uniqueness or verified ownership is implied.

A track carries optional \`creator: { id, name }\` and optional \`origin: "imported"\`.
The existing v8 track and export v1 formats remain compatible: normalization accepts
these two additions and leaves older tracks valid. Imported tracks retain any credited
creator and are explicitly marked imported even if uncredited; future local nickname
changes must not claim them. Official tracks use the Track Forge credit.

On the first nickname selection, old **uncredited, unmarked** library tracks are claimed
by the local profile. Historical imports were not marked before this release and thus
cannot be distinguished from local creations. The first-launch dialog explains this
limitation instead of falsely promising perfect migration. From then on, only tracks
credited to this installation are renamed.

The migration does not touch geometry, updatedAt or raceRevision, so score and ghost
category identity remains stable. The browser repository uses one atomic library write
for attribution when supported; failed writes do not update the display-name
preference and are reported so the operation can be retried. A failed preference write
may leave track credits updated; retries are idempotent.

Exports carry creator attribution. A creator ID is **not** proof of ownership and must
never be used for authorization when online accounts or community uploads are added.
A future authenticated identity should keep the stable author key server-side and
resolve display names dynamically rather than trusting imported author IDs.
