# Road-contact recovery and checkpoint authoring

## Contracts

- RECOVER returns the player to the **latest safe, grounded road contact**, not to the last user-placed recovery checkpoint. Water, wreck and scenery recoveries use the same source when available.
- The tracked road index is anchored to actual road support. It must not jump to the other arm of an overlapping road or elevated crossing, or advance past a missing timing gate. If the contact is unsafe or invalid, prefer the last valid authored checkpoint as a fallback, then the existing gate-limited fallback; never award a missed sector or lap.
- A **missed timing finish** (gate 4) is a special case: whether the driver taps RECOVER or the grace timer expires, place them on safe road roughly one road half-width **before** the finish stripe in race direction, not at recent road contact that may already be on the next lap. If that approach is flooded, search farther backward for safe road; if none exists, use the approach with temporary water recovery protection. Keep the current lap and pending finish gate unchanged. This applies to normal/reverse circuits with relocated starts and to point-to-point finishes.
- Author-created recovery checkpoint markers remain visible in the editor and during racing. They do **not** determine the manual respawn location. Checkpoint progress and sector timing remain distinct.
- New tracks default to automatic checkpoint additions: one per **ten authoring control points** during draw. The marker is placed near the penultimate control point on the compiled safe road, avoiding the open-path endpoint. The ratio is provisional tuning, not a gameplay difficulty setting.
- Automatic addition **only appends** a new marker at each tenth point; it does not regenerate deleted or manually moved markers. Existing markers retain their approximate world distance as the road extends. Imported/older tracks do not silently gain checkpoints.
- In the Checkpoint tool, tap road to add, tap marker to remove, or drag marker along safe road to move. A two-finger navigation gesture cancels the whole change; undo/redo captures the gesture. Checkpoints use the existing serialized ratio list, so no track format version bump.

## Tests and risks

Cheap domain/component checks cover checkpoint cadence, extension, moving and deleting, gesture undo/cancel, physical recovery on crossing arms, and missing timing gates. Full gates are `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Physical Android touch testing remains relevant for screen-space hit targets.

The road-path ratios are proportional to centreline distance while extension rebasing uses authored control-line distance: for strongly curved edits some small visual drift is possible. Keep this behaviour observable and improve it if tuning reveals actual user friction. Rollback is the single feature PR without migration.
