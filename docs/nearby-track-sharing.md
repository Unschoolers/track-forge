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
