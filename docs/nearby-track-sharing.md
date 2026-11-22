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

Verification should include two Android devices (advertise/discover, permissions, save picker/storage errors, host and guest Leave), with targeted component tests and in-memory Nearby integration tests before browser smoke checks. No Android native code or packet pose format is modified.

## Nearby race position and results (optional telemetry)

Race standings for active cars use the same checkpoint-aware path-progress calculation as the local single-player race. An **optional 8-byte progress packet** (type 4, slot/sequence/float32 progress) is sent at most every 150 ms alongside the unchanged 19-byte pose stream. The host relays valid guest samples, rejecting stale sequence numbers and unauthorized slots. Progress packets are scoped to the current round and cleared on rematch/leave.

Older clients simply ignore progress packets: they continue displaying remote cars, but the HUD falls back to **LIVE** instead of fabricating a position. New clients also fall back if an active peer's sample becomes stale (more than 1.5 seconds). These samples affect only UI ranks and overtake feedback: local physics, checkpoint validation and the existing finish-time order remain authoritative. Multiplayer has no solo time-medal or score category.

The podium only settles once every participant has a finish, DNF or departure state. This avoids announcing a premature victory while someone else is still racing.

## Congestion policy and checkpoint correctness (2026-11-22)

Nearby pose packets remain **19 bytes per car** (type 1), including the existing recovery and sequence fields. Host batches remain type 3, and optional standings telemetry remains **8 bytes every 150 ms at most** (type 4). No protocol version, track serialization or lobby handshake changes are needed; existing installed peers understand the same packets.

- Each recipient has **at most one pending pose transmission** and one pending progress transmission. When a send is pending, newer simulation frames replace the older intent: they are not enqueued and never delay delivery to a healthy opponent. Host relays include only recent, authorized, distinct guest slots.
- The native BYTES timeout for transient pose/progress packets is 600 ms rather than 250 ms, accommodating short wireless delays without letting transient sends block for the 10 seconds reserved for critical control/track messages. A missing/disconnected target is a delivery failure, not success.
- A remote car holds its last bounded pose for at most 2 seconds without fresh packets (prediction remains capped at 120 ms and 75 world units). Beyond that it disappears rather than pretending a disconnected car is still live. Leave/finish events still remove it immediately.
- The **local 60 Hz deterministic simulation alone** decides checkpoints. Nearby progress packets are visual HUD telemetry and cannot grant/deny a gate. A nearest-sample advance may now start a missed-gate countdown only after the chassis is clearly beyond the physical checkpoint plane. Painted-stripe sweep, elevation and direction checks remain authoritative.

**Failure model:** No transport can guarantee low latency under persistent interference. Saturation reduces one peer's pose rate while preserving updates to other peers; late/stale packets are rejected by existing modulo-16-bit sequences. Optional progress can become unknown/LIVE rather than block physics or flood native send queues.

**Reproduction/verification:** Unit tests cover a hung host recipient with another receiving fresh batches, bounded per-peer telemetry and relay, short wireless stalls without vanishing, and the car position vs checkpoint progress-index mismatch. Device QA still required on at least two Android phones: measure send/receive rates, loss/age p50/p95/p99 and perceived checkpoint accuracy on crossings, hills and diagonals, with a deliberately congested third peer if available. The theoretical improvement (a stalled peer no longer gates healthy peers) is tested; there is no claim of measured radio latency improvement without device traces. Rollback is a single PR revert; no data migration.
