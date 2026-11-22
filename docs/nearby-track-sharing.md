# Nearby track sharing and persistent race rooms

## Track sharing (Android Nearby Connections)

From Track Library choose **NEARBY** on a saved track. This advertises `Track ####`, distinct from the existing `Room ####` race rooms. On a second device open Nearby and choose **RECEIVE TRACK**, select the advertised sender and approve the incoming track.

- This uses the **existing** Nearby transport, compressed track chunker and strict shared-track importer. No Internet service, new Android permissions or second transfer protocol is necessary.
- Guest devices initiate a share-ready handshake before the sender begins streaming. The sender compresses the track only once and can serve up to three connected guests.
- The receiver previews the track's name and must explicitly choose **SAVE TRACK** or **DECLINE**. Saving calls `TrackLibraryService.importShared`, which creates a new local ID/name and never overwrites a track, high score or ghost.
- The sender only reports confirmed saves, with acknowledgement counts deduplicated by peer. Track bytes are bounded by existing transfer limits and malformed imports are rejected before storage.
- **LEAVE/BACK** ends the sharing session; the host disconnects all peers.

## Hosting a Nearby race

From **Nearby**, choose **CHOOSE TRACK TO HOST** (the primary action), then select a race-ready saved or official circuit. Track selection opens the Nearby room directly: it must not enter the single-player race setup or start a solo session. Closing the picker returns to Nearby without advertising a room. **START RACE** in the host lobby is disabled until at least one guest has connected; only the Nearby session may start the multiplayer race. The chosen circuit's lighting and the saved lap preference apply, with a single run for point-to-point courses. The normal **RACE** flow remains single-player.

## Nearby rematches

The host and guests remain connected after a race; the results screen stays open. Once all racers finish or leave:

1. Host taps **RACE** to start another round on the current track.
2. Or host taps **SELECT TRACK**, picks a different race-ready circuit from the library, then taps **RACE**.
3. Guests remain in the results screen until the host prepares the next track. New race scenes and synchronized countdowns replace old results automatically.
4. **LEAVE** explicitly disconnects: host closes the room for all; a guest disconnects only themselves.

Every new race run (including **RACE AGAIN** on the same track with unchanged lighting) must recreate the Phaser race scene. The scene's create hook reports readiness again, allowing the host to schedule GO only after all rematch participants are armed. Countdown/pose snapshot updates within a run must not recreate the scene.

The first round uses the existing room lock; rematches reuse established peer connections without locking a second time. Each round increments a bounded, validated identifier carried on control messages. Previous-round finishes/ready messages are rejected while preparing or racing again. Existing untagged controls are treated as round zero for compatibility with the first round.

## Behavior and testing boundaries

The local race engine and ghost/score storage are unchanged. The sharing mode permits unready draft tracks, whereas rematch track selection requires race-ready validation. The UI and session use explicit phase guards and retain the current player identity, peers and car configuration.

Verification should include two Android devices (advertise/discover, permissions, save picker/storage errors, host and guest Leave), with targeted component tests and in-memory Nearby integration tests before browser smoke checks. The rematch epoch packet extension and lobby version check are documented below; track sharing remains unaffected.

## Nearby race position and results (optional telemetry)

Race standings for active cars use the same checkpoint-aware path-progress calculation as the local single-player race. An **optional 8-byte progress packet** (type 4, slot/sequence/float32 progress) is sent at most every 150 ms alongside the unchanged 19-byte pose stream. The host relays valid guest samples, rejecting stale sequence numbers and unauthorized slots. Progress packets are scoped to the current round and cleared on rematch/leave.

Older clients simply ignore progress packets: they continue displaying remote cars, but the HUD falls back to **LIVE** instead of fabricating a position. New clients also fall back if an active peer's sample becomes stale (more than 1.5 seconds). These samples affect only UI ranks and overtake feedback: local physics, checkpoint validation and the existing finish-time order remain authoritative. Multiplayer has no solo time-medal or score category.

The podium only settles once every participant has a finish, DNF or departure state. This avoids announcing a premature victory while someone else is still racing.

## Congestion policy and checkpoint correctness (2026-11-22)

Nearby pose packets remain **19 bytes per car** (type 1), including recovery and sequence fields. The host sends **one compact binary batch** (type 3) to all eligible connected guests per cadence tick, not one app-level send per player; optional standings telemetry remains **8 bytes every 150 ms at most** (type 4). This section describes the 2026-11-22 congestion fix. The later rematch epoch extension below adds a lobby version check without changing packet lengths or the saved track format.

- Google Nearby's `sendPayload(List<String>, Payload)` is designed for multiple endpoints per call. The Android transport retains one multicast operation and applies **per-endpoint backpressure internally**. Each destination can have at most one outstanding pose and one outstanding progress packet. When one radio is congested, that endpoint skips obsolete snapshots until it acknowledges or times out, while all eligible healthy endpoints receive the **same freshly encoded batch** in a single native send.
- The native BYTES enqueue result indicates *acceptance into the Nearby transport*, not delivery. This now releases the app-side cadence gate promptly for optional pose/progress packets; per-endpoint transfer results separately control native congestion. **Control and track packets still require successful delivery to all recipients**. Native diagnostics track skipped transient samples, failed transfers and timeouts.
- Transient sends have a bounded 600 ms transfer window. A disconnected requested target returns an explicit failure for control/track sends; transient radio stalls only skip disposable samples. The transport clears pending windows on disconnect or stop.
- A remote car holds its last bounded pose for at most 2 seconds without fresh packets (prediction remains capped at 120 ms and 75 world units). Beyond that the ghost disappears rather than pretending a disconnected car is still live. Leave/finish events remove it immediately.
- The **local fixed 60 Hz deterministic simulation alone** decides checkpoint validity. Nearby progress is HUD telemetry only and cannot grant or deny a gate. A nearest-sample jump may start a missed-gate countdown only after the chassis is physically beyond the checkpoint plane (with the open-stage finish bypass handled by its existing physical-plane test).

**Lightweight race diagnostics:** The existing download action exports schema version 2 with UTC timestamps, the circuit ID/name/revision, route, lighting, lap and round, plus all known racer slots (0–3), display names, car colors, topper icons/colors, finish/leave status and which device is local. Slot IDs are race-scoped, allowing the host and guest exports to be compared without exposing raw Android Nearby endpoint IDs, pairing codes or room codes. An export after leaving or failing preserves the last race snapshot. A new round starts fresh per-player counters.

Pose and progress reports track per-slot accepted/stale updates, sequence gaps (which may reflect intentional congestion skipping, **not proof of radio loss**), mean/max receive gaps, bounded histogram-derived p95 gap upper bounds, >250/>500/>2000 ms stalls and current silence. The native report still includes global transient send/drop/timeout counters and device/radio status. Metrics use a fixed nine-bin histogram and four slots per stream, update only on received packets, and do not retain raw packets or run work each animation frame. The detailed report is assembled only when the user requests a download; no settings toggle is required. In-progress stalls are inferred from time since the last received sample at export, so diagnosing a completed race is more reliable with both host and guest reports before leaving.

**Failure model:** Even multicast cannot guarantee smooth delivery under persistent wireless interference. Congestion lowers the affected peer's actual receive rate without blocking healthy players or allowing an unbounded queue. Late/stale packets are rejected by existing modulo-16-bit sequences. Optional rank telemetry may become unknown/LIVE instead of making up a standing.

**Verification:** Component tests cover one app-level host broadcast and 19-byte wire compatibility. Native JVM tests cover independent per-endpoint pose/progress backpressure, expiration and disconnect. Domain tests cover checkpoint progress-index jumps and genuine bypasses. Physical testing still requires at least two Android phones: p50/p95/p99 receive intervals, losses, device load, 2-4 player races (including a congested third peer), scene rematches, diagonal checkpoints, overpasses and disconnect. No claim of measured wireless improvement until real-device traces are collected. Rollback is this single PR; no data migration.

## Rematch packet epochs and APK compatibility (wire protocol v2)

A delayed pose/progress packet from the previous race can otherwise poison a
fresh rematch after sequence counters reset. A **five-bit round epoch** now
occupies previously unused header bits in each **19-byte pose / 8-byte progress**
packet; host batches reject mixed epochs. The existing reliable control round
identifier still uses 16 bits. Wire epochs repeat after 32 rounds, so they are
not cryptographic replay protection or an indefinite sequence identifier.

This changes the meaning of reserved packet header bits: **old and new APKs
must not participate in the same race**. Reliable `prepare` (host) and `ready`
(guest) controls advertise `protocolVersion: 2`. Missing or mismatched versions
are decoded, then **rejected before staging or starting a race**, displaying
“Multiplayer version mismatch. Update Track Forge on every device.” on the
client that detects the mismatch. An older APK cannot be made to display this
new message; it will observe a disconnection, while the updated peer shows the
update instruction. This fail-closed check also applies to the first race, not
just rematches. Track-sharing control messages are unchanged.

The tests cover a legacy host sending an unversioned `prepare`, a legacy guest
replying with an unversioned `ready`, invalid version values, and stale/mixed
round packets. Release validation must also include 2–4 actual Android devices:
rematch, connection loss, and one outdated APK (confirm no race starts and the
updated peer sees the message). Unit/CI checks do not establish radio quality.


## Host-selected Day/Night lighting

After selecting a normal race track or a Nearby Cup, the host can choose **DAY** or **NIGHT** from the hosting lobby. All connected players receive the chosen lighting in the existing reliable race preparation message. The chosen override applies to subsequent Cup tracks and new race track selections in the same room; it does not edit the saved track. When no choice is made, each track uses its stored lighting. Track sharing has no lighting selector. The selection remains host-authoritative to avoid players racing in inconsistent visibility conditions.
